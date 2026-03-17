import {
	CURRENT_API_VERSION,
	CURRENT_SKILL_VERSION,
	HeartbeatRequestSchema,
	RegisterNodeRequestSchema,
	type VersionUpdateInfo,
} from "@fairygitmother/core";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, submissions, votes } from "../db/schema.js";
import { dequeueAndAssign } from "../orchestrator/queue.js";
import { heartbeat, registerNode, removeNode } from "../orchestrator/registry.js";

interface VersionCheckConfig {
	latestVersion: string;
	npm: string;
	pnpm: string;
	manual: string;
}

const SKILL_VERSION_CONFIG: VersionCheckConfig = {
	latestVersion: CURRENT_SKILL_VERSION,
	npm: "npm install @fairygitmother/skill-openclaw@latest",
	pnpm: "pnpm add @fairygitmother/skill-openclaw@latest",
	manual:
		"https://github.com/buildepicshit/FairygitMother/blob/main/packages/skill-openclaw/SKILL.md",
};

const API_VERSION_CONFIG: VersionCheckConfig = {
	latestVersion: CURRENT_API_VERSION,
	npm: "npm install @fairygitmother/core@latest @fairygitmother/node@latest",
	pnpm: "pnpm add @fairygitmother/core@latest @fairygitmother/node@latest",
	manual: "https://github.com/buildepicshit/FairygitMother/blob/main/packages/core/src/protocol.ts",
};

function buildVersionUpdate(
	clientVersion: string | undefined,
	config: VersionCheckConfig,
): VersionUpdateInfo | null {
	if (clientVersion === config.latestVersion) return null;
	return {
		updateAvailable: true,
		currentVersion: clientVersion ?? "unknown",
		latestVersion: config.latestVersion,
		updateInstructions: {
			npm: config.npm,
			pnpm: config.pnpm,
			openclaw: "openclaw install fairygitmother@latest",
			manual: config.manual,
		},
		changelog: "https://github.com/buildepicshit/FairygitMother/releases",
	};
}

async function findPendingReview(db: FairygitMotherDb, nodeId: string) {
	// Find submissions awaiting review where this node hasn't voted and isn't the solver
	const pendingSubmissions = await db
		.select()
		.from(submissions)
		.innerJoin(bounties, eq(submissions.bountyId, bounties.id))
		.where(inArray(bounties.status, ["diff_submitted", "in_review"]));

	// Batch-fetch all votes by this reviewer to avoid N+1 queries
	const myVotes = await db
		.select({ submissionId: votes.submissionId })
		.from(votes)
		.where(eq(votes.reviewerNodeId, nodeId));
	const votedSubmissions = new Set(myVotes.map((v) => v.submissionId));

	for (const row of pendingSubmissions) {
		if (row.submissions.nodeId === nodeId) continue;
		if (votedSubmissions.has(row.submissions.id)) continue;

		// Transition to in_review if still diff_submitted
		if (row.bounties.status === "diff_submitted") {
			await db
				.update(bounties)
				.set({ status: "in_review", updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, row.bounties.id));
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
		const result = await registerNode(db, displayName, capabilities, solverBackend);

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

		await heartbeat(db, nodeId, parsed.data.status, parsed.data.tokensUsedSinceLastHeartbeat);

		let pendingBounty = null;
		let pendingReview = null;

		if (parsed.data.status === "idle") {
			// Reviews take priority over new bounties
			pendingReview = await findPendingReview(db, nodeId);

			if (!pendingReview) {
				const bounty = await dequeueAndAssign(db, nodeId);
				if (bounty) {
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

		const skillUpdate = buildVersionUpdate(parsed.data.skillVersion, SKILL_VERSION_CONFIG);
		const apiUpdate = buildVersionUpdate(parsed.data.apiVersion, API_VERSION_CONFIG);

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

		await removeNode(db, nodeId);
		return c.json({ removed: true });
	});

	return app;
}
