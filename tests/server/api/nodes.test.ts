import {
	CURRENT_API_VERSION,
	CURRENT_SKILL_VERSION,
	generateApiKey,
	generateId,
} from "@fairygitmother/core";
import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

async function registerNode(app: ReturnType<typeof createApp>) {
	const res = await app.request("/api/v1/nodes/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			capabilities: { languages: [], tools: [] },
			solverBackend: "test",
		}),
	});
	return res.json() as Promise<{ nodeId: string; apiKey: string }>;
}

function authHeaders(apiKey: string): Record<string, string> {
	return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

describe("nodes API", () => {
	let db: TestDb;
	let app: ReturnType<typeof createApp>;

	beforeEach(async () => {
		db = createTestDb();
		app = createApp(db);
		await cleanAllTables(db);
	});

	describe("POST /api/v1/nodes/register", () => {
		it("registers a new node", async () => {
			const res = await app.request("/api/v1/nodes/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					displayName: "TestNode",
					capabilities: { languages: ["TypeScript"], tools: ["openclaw"] },
					solverBackend: "openclaw",
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.nodeId).toMatch(/^node_/);
			expect(body.apiKey).toMatch(/^mf_/);
		});

		it("rejects invalid registration", async () => {
			const res = await app.request("/api/v1/nodes/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ invalid: true }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/v1/nodes/:id/heartbeat", () => {
		it("acknowledges heartbeat", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({ status: "idle", tokensUsedSinceLastHeartbeat: 0 }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.acknowledged).toBe(true);
		});

		it("rejects without auth", async () => {
			const { nodeId } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "idle", tokensUsedSinceLastHeartbeat: 0 }),
			});

			expect(res.status).toBe(401);
		});
	});

	describe("DELETE /api/v1/nodes/:id", () => {
		it("removes a node", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}`, {
				method: "DELETE",
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			expect(res.status).toBe(200);
		});
	});

	describe("version handshake", () => {
		it("returns no updates when both versions match", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
					apiVersion: CURRENT_API_VERSION,
				}),
			});

			const body = await res.json();
			expect(body.skillUpdate).toBeNull();
			expect(body.apiUpdate).toBeNull();
		});

		it("returns skillUpdate when skill version is outdated", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: "0.1.0",
					apiVersion: CURRENT_API_VERSION,
				}),
			});

			const body = await res.json();
			expect(body.skillUpdate).not.toBeNull();
			expect(body.skillUpdate.updateAvailable).toBe(true);
			expect(body.skillUpdate.currentVersion).toBe("0.1.0");
			expect(body.skillUpdate.latestVersion).toBe(CURRENT_SKILL_VERSION);
			expect(body.skillUpdate.updateInstructions.npm).toContain("npm install");
			expect(body.skillUpdate.updateInstructions.pnpm).toContain("pnpm add");
			expect(body.skillUpdate.updateInstructions.openclaw).toContain("openclaw install");
			expect(body.skillUpdate.changelog).toContain("github.com");
			expect(body.apiUpdate).toBeNull();
		});

		it("returns apiUpdate when API version is outdated", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
					apiVersion: "0.0.1",
				}),
			});

			const body = await res.json();
			expect(body.skillUpdate).toBeNull();
			expect(body.apiUpdate).not.toBeNull();
			expect(body.apiUpdate.updateAvailable).toBe(true);
			expect(body.apiUpdate.currentVersion).toBe("0.0.1");
			expect(body.apiUpdate.latestVersion).toBe(CURRENT_API_VERSION);
			expect(body.apiUpdate.updateInstructions.npm).toContain("@fairygitmother/core");
		});

		it("returns both updates when both versions missing", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
				}),
			});

			const body = await res.json();
			expect(body.skillUpdate).not.toBeNull();
			expect(body.skillUpdate.currentVersion).toBe("unknown");
			expect(body.apiUpdate).not.toBeNull();
			expect(body.apiUpdate.currentVersion).toBe("unknown");
		});
	});

	describe("review dispatch priority", () => {
		async function createSolverWithSubmission() {
			// Create a solver node directly in DB
			const solverId = generateId("node");
			await db.insert(schema.nodes).values({
				id: solverId,
				apiKey: generateApiKey(),
				capabilities: { languages: [], tools: [] },
				solverBackend: "test",
				totalBountiesSolved: 10,
			});

			// Create a bounty in diff_submitted state
			const bountyId = generateId("bty");
			await db.insert(schema.bounties).values({
				id: bountyId,
				owner: "org",
				repo: "repo",
				issueNumber: 1,
				issueTitle: "Fix bug",
				issueBody: "It's broken",
				labels: [],
				status: "diff_submitted",
			});

			// Create a submission
			const submissionId = generateId("sub");
			await db.insert(schema.submissions).values({
				id: submissionId,
				bountyId,
				nodeId: solverId,
				diff: "+fix",
				explanation: "Fixed the bug",
				filesChanged: ["file.ts"],
				solverBackend: "test",
				solveDurationMs: 5000,
			});

			return { solverId, bountyId, submissionId };
		}

		it("returns pendingReview over pendingBounty when both available", async () => {
			const { submissionId } = await createSolverWithSubmission();

			// Create a second bounty that's queued (available for solving)
			await db.insert(schema.bounties).values({
				id: generateId("bty"),
				owner: "org2",
				repo: "repo2",
				issueNumber: 2,
				issueTitle: "Another bug",
				issueBody: "Also broken",
				labels: [],
				status: "queued",
			});

			// Register a reviewer node via API
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
				}),
			});

			const body = await res.json();
			// Should get the review, NOT the bounty
			expect(body.pendingReview).not.toBeNull();
			expect(body.pendingReview.submissionId).toBe(submissionId);
			expect(body.pendingReview.diff).toBe("+fix");
			expect(body.pendingReview.issueTitle).toBe("Fix bug");
			expect(body.pendingBounty).toBeNull();
		});

		it("does not assign solver to review their own submission", async () => {
			const { solverId } = await createSolverWithSubmission();

			// Get the solver's apiKey from DB
			const solverNode = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, solverId))
			)[0];

			// Solver heartbeats — should NOT get their own submission as a review
			const res = await app.request(`/api/v1/nodes/${solverId}/heartbeat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${solverNode!.apiKey}`,
				},
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
				}),
			});

			const body = await res.json();
			// Solver should NOT get their own review
			expect(body.pendingReview).toBeNull();
		});

		it("transitions bounty to in_review when dispatched via heartbeat", async () => {
			const { bountyId } = await createSolverWithSubmission();

			const { nodeId, apiKey } = await registerNode(app);

			await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
				}),
			});

			// Bounty should now be in_review
			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("in_review");
		});

		it("returns pendingBounty when no reviews pending", async () => {
			// Only a queued bounty, no submissions
			await db.insert(schema.bounties).values({
				id: generateId("bty"),
				owner: "org",
				repo: "repo",
				issueNumber: 1,
				issueTitle: "Solo bug",
				issueBody: "Just a bounty",
				labels: [],
				status: "queued",
			});

			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: CURRENT_SKILL_VERSION,
				}),
			});

			const body = await res.json();
			expect(body.pendingReview).toBeNull();
			expect(body.pendingBounty).not.toBeNull();
			expect(body.pendingBounty.issueTitle).toBe("Solo bug");
		});
	});
});
