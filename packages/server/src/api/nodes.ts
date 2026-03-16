import {
	CURRENT_API_VERSION,
	CURRENT_SKILL_VERSION,
	HeartbeatRequestSchema,
	RegisterNodeRequestSchema,
	type VersionUpdateInfo,
} from "@fairygitmother/core";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, submissions, votes } from "../db/schema.js";
import { dequeueForNode, markAssigned } from "../orchestrator/queue.js";
import { heartbeat, registerNode, removeNode } from "../orchestrator/registry.js";

function buildSkillUpdate(clientVersion: string | undefined): VersionUpdateInfo | null {
	if (clientVersion === CURRENT_SKILL_VERSION) return null;
	return {
		updateAvailable: true,
		currentVersion: clientVersion ?? "unknown",
		latestVersion: CURRENT_SKILL_VERSION,
		updateInstructions: {
			npm: "npm install @fairygitmother/skill-openclaw@latest",
			pnpm: "pnpm add @fairygitmother/skill-openclaw@latest",
			openclaw: "openclaw install fairygitmother@latest",
			manual:
				"https://github.com/buildepicshit/FairygitMother/blob/main/packages/skill-openclaw/SKILL.md",
		},
		changelog: "https://github.com/buildepicshit/FairygitMother/releases",
	};
}

function buildApiUpdate(clientVersion: string | undefined): VersionUpdateInfo | null {
	if (clientVersion === CURRENT_API_VERSION) return null;
	return {
		updateAvailable: true,
		currentVersion: clientVersion ?? "unknown",
		latestVersion: CURRENT_API_VERSION,
		updateInstructions: {
			npm: "npm install @fairygitmother/core@latest @fairygitmother/node@latest",
			pnpm: "pnpm add @fairygitmother/core@latest @fairygitmother/node@latest",
			openclaw: "openclaw install fairygitmother@latest",
			manual:
				"https://github.com/buildepicshit/FairygitMother/blob/main/packages/core/src/protocol.ts",
		},
		changelog: "https://github.com/buildepicshit/FairygitMother/releases",
	};
}

function findPendingReview(db: FairygitMotherDb, nodeId: string) {
	// Find submissions awaiting review where this node hasn't voted and isn't the solver
	const pendingSubmissions = db
		.select()
		.from(submissions)
		.innerJoin(bounties, eq(submissions.bountyId, bounties.id))
		.where(inArray(bounties.status, ["diff_submitted", "in_review"]))
		.all();

	for (const row of pendingSubmissions) {
		// Skip if this node is the solver
		if (row.submissions.nodeId === nodeId) continue;

		// Skip if this node already voted
		const existingVote = db
			.select()
			.from(votes)
			.where(and(eq(votes.submissionId, row.submissions.id), eq(votes.reviewerNodeId, nodeId)))
			.get();
		if (existingVote) continue;

		// Transition to in_review if still diff_submitted
		if (row.bounties.status === "diff_submitted") {
			db.update(bounties)
				.set({ status: "in_review", updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, row.bounties.id))
				.run();
		}

		return {
			submissionId: row.submissions.id,
			bountyId: row.bounties.id,
			owner: row.bounties.owner,
			repo: row.bounties.repo,
			issueNumber: row.bounties.issueNumber,
			issueTitle: row.bounties.issueTitle,
			issueBody: row.bounties.issueBody,
			diff: row.submissions.diff,
			explanation: row.submissions.explanation,
		};
	}

	return null;
}

export function createNodeRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// POST /api/v1/nodes/register
	app.post("/register", async (c) => {
		const body = await c.req.json();
		const parsed = RegisterNodeRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
		}

		const { displayName, capabilities, solverBackend } = parsed.data;
		const result = registerNode(db, displayName, capabilities, solverBackend);

		return c.json({ nodeId: result.id, apiKey: result.apiKey }, 201);
	});

	// POST /api/v1/nodes/:id/heartbeat
	app.post("/:id/heartbeat", async (c) => {
		const nodeId = c.req.param("id");
		const authenticatedNodeId = c.get("nodeId") as string;
		if (authenticatedNodeId !== nodeId) {
			return c.json({ error: "Forbidden: node ID mismatch" }, 403);
		}

		const body = await c.req.json();
		const parsed = HeartbeatRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request" }, 400);
		}

		heartbeat(db, nodeId, parsed.data.status, parsed.data.tokensUsedSinceLastHeartbeat);

		let pendingBounty = null;
		let pendingReview = null;

		if (parsed.data.status === "idle") {
			// Reviews take priority over new bounties
			pendingReview = findPendingReview(db, nodeId);

			if (!pendingReview) {
				const bounty = dequeueForNode(db, nodeId);
				if (bounty) {
					markAssigned(db, bounty.id, nodeId);
					pendingBounty = {
						...bounty,
						repoUrl: `https://github.com/${bounty.owner}/${bounty.repo}`,
						status: "assigned" as const,
						assignedNodeId: nodeId,
						retryCount: 0,
						createdAt: new Date().toISOString(),
					};
				}
			}
		}

		const skillUpdate = buildSkillUpdate(parsed.data.skillVersion);
		const apiUpdate = buildApiUpdate(parsed.data.apiVersion);

		return c.json({
			acknowledged: true,
			pendingBounty,
			pendingReview,
			skillUpdate,
			apiUpdate,
		});
	});

	// DELETE /api/v1/nodes/:id
	app.delete("/:id", async (c) => {
		const nodeId = c.req.param("id");
		const authenticatedNodeId = c.get("nodeId") as string;
		if (authenticatedNodeId !== nodeId) {
			return c.json({ error: "Forbidden: node ID mismatch" }, 403);
		}

		removeNode(db, nodeId);
		return c.json({ removed: true });
	});

	return app;
}
