import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { generateId, SubmitFixRequestSchema } from "@fairygitmother/core";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, submissions, repos } from "../db/schema.js";
import { dequeueForNode, markAssigned } from "../orchestrator/queue.js";
import { scanDiff } from "../consensus/safety.js";
import { emitEvent } from "./feed.js";
import { logAudit } from "../audit.js";

// ── Submission-first: repos/maintainers submit issues to us ────

const SubmitBountyRequestSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	issueNumber: z.number().int().positive(),
	issueTitle: z.string().min(1),
	issueBody: z.string().default(""),
	labels: z.array(z.string()).default([]),
	language: z.string().nullable().default(null),
	complexityEstimate: z.number().int().min(1).max(5).default(3),
});

export function createBountyRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// GET /api/v1/bounties — list bounties with optional filters
	app.get("/", (c) => {
		const status = c.req.query("status");
		const owner = c.req.query("owner");
		const repo = c.req.query("repo");
		const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);

		let query = db.select().from(bounties).$dynamic();

		if (status) {
			query = query.where(eq(bounties.status, status));
		}
		if (owner && repo) {
			query = query.where(and(eq(bounties.owner, owner), eq(bounties.repo, repo)));
		}

		const results = query.limit(limit).all();
		return c.json({ bounties: results });
	});

	// POST /api/v1/bounties — submission-first: maintainers submit issues
	app.post("/", async (c) => {
		const body = await c.req.json();
		const parsed = SubmitBountyRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
		}

		const { owner, repo, issueNumber, issueTitle, issueBody, labels, language, complexityEstimate } =
			parsed.data;

		// Check for duplicate
		const existing = db
			.select()
			.from(bounties)
			.where(
				and(
					eq(bounties.owner, owner),
					eq(bounties.repo, repo),
					eq(bounties.issueNumber, issueNumber),
				),
			)
			.get();

		if (existing) {
			return c.json({ error: "Bounty already exists", bountyId: existing.id }, 409);
		}

		// Ensure repo exists in our registry
		const repoRow = db
			.select()
			.from(repos)
			.where(and(eq(repos.owner, owner), eq(repos.name, repo)))
			.get();

		if (!repoRow) {
			db.insert(repos)
				.values({ owner, name: repo, language, optInTier: "explicit" })
				.run();
		}

		const bountyId = generateId("bty");
		db.insert(bounties)
			.values({
				id: bountyId,
				owner,
				repo,
				issueNumber,
				issueTitle,
				issueBody,
				labels,
				language,
				complexityEstimate,
				status: "queued",
				assignedNodeId: null,
				priority: 50,
				retryCount: 0,
			})
			.run();

		emitEvent({
			type: "bounty_created",
			bounty: {
				id: bountyId,
				repoUrl: `https://github.com/${owner}/${repo}`,
				owner,
				repo,
				issueNumber,
				issueTitle,
				issueBody,
				labels,
				language,
				complexityEstimate,
				status: "queued",
				assignedNodeId: null,
				priority: 50,
				retryCount: 0,
				createdAt: new Date().toISOString(),
			},
		});
		logAudit(db, "bounty_created", bountyId, { owner, repo, issueNumber });

		return c.json({ bountyId, status: "queued" }, 201);
	});

	// POST /api/v1/bounties/claim — node claims next available bounty
	app.post("/claim", async (c) => {
		const nodeId = c.get("nodeId") as string;

		const bounty = dequeueForNode(db, nodeId);
		if (!bounty) {
			return c.json({ bounty: null });
		}

		markAssigned(db, bounty.id, nodeId);
		logAudit(db, "bounty_assigned", bounty.id, { nodeId });

		emitEvent({
			type: "bounty_assigned",
			bountyId: bounty.id,
			nodeId,
		});

		return c.json({
			bounty: {
				...bounty,
				repoUrl: `https://github.com/${bounty.owner}/${bounty.repo}`,
				status: "assigned",
				assignedNodeId: nodeId,
				retryCount: 0,
				createdAt: new Date().toISOString(),
			},
		});
	});

	// POST /api/v1/bounties/:id/submit — submit a fix for a bounty
	app.post("/:id/submit", async (c) => {
		const bountyId = c.req.param("id");
		const body = await c.req.json();
		const parsed = SubmitFixRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
		}

		const bounty = db.select().from(bounties).where(eq(bounties.id, bountyId)).get();
		if (!bounty) {
			return c.json({ error: "Bounty not found" }, 404);
		}

		// Safety scan
		const safety = scanDiff(parsed.data.diff, parsed.data.filesChanged);
		if (!safety.safe) {
			return c.json(
				{ submissionId: null, status: "rejected_safety", safetyIssues: safety.issues },
				422,
			);
		}

		const submissionId = generateId("sub");
		db.insert(submissions)
			.values({
				id: submissionId,
				bountyId,
				nodeId: bounty.assignedNodeId ?? "unknown",
				diff: parsed.data.diff,
				explanation: parsed.data.explanation,
				filesChanged: parsed.data.filesChanged,
				testsPassed: parsed.data.testsPassed,
				tokensUsed: parsed.data.tokensUsed,
				solverBackend: parsed.data.solverBackend,
				solveDurationMs: parsed.data.solveDurationMs,
			})
			.run();

		db.update(bounties)
			.set({ status: "diff_submitted", updatedAt: new Date().toISOString() })
			.where(eq(bounties.id, bountyId))
			.run();

		emitEvent({
			type: "fix_submitted",
			submissionId,
			bountyId,
		});
		logAudit(db, "fix_submitted", submissionId, { bountyId, nodeId: bounty.assignedNodeId });

		return c.json({ submissionId, status: "accepted" }, 201);
	});

	return app;
}
