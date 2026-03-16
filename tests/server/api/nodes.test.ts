import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURRENT_SKILL_VERSION, generateApiKey, generateId } from "@fairygitmother/core";
import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

function createTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const migration = readFileSync(
		resolve(import.meta.dirname, "../../../migrations/0001_initial.sql"),
		"utf-8",
	);
	sqlite.exec(migration);
	return drizzle(sqlite, { schema });
}

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
	let db: ReturnType<typeof createTestDb>;
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		db = createTestDb();
		app = createApp(db);
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

	describe("skill version handshake", () => {
		it("returns no skillUpdate when version matches", async () => {
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
			expect(body.skillUpdate).toBeNull();
		});

		it("returns skillUpdate when version is outdated", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			const res = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
					skillVersion: "0.1.0",
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
		});

		it("returns skillUpdate when version is missing", async () => {
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
			expect(body.skillUpdate.latestVersion).toBe(CURRENT_SKILL_VERSION);
		});
	});

	describe("review dispatch priority", () => {
		function createSolverWithSubmission() {
			// Create a solver node directly in DB
			const solverId = generateId("node");
			db.insert(schema.nodes)
				.values({
					id: solverId,
					apiKey: generateApiKey(),
					capabilities: { languages: [], tools: [] },
					solverBackend: "test",
					totalBountiesSolved: 10,
				})
				.run();

			// Create a bounty in diff_submitted state
			const bountyId = generateId("bty");
			db.insert(schema.bounties)
				.values({
					id: bountyId,
					owner: "org",
					repo: "repo",
					issueNumber: 1,
					issueTitle: "Fix bug",
					issueBody: "It's broken",
					labels: [],
					status: "diff_submitted",
				})
				.run();

			// Create a submission
			const submissionId = generateId("sub");
			db.insert(schema.submissions)
				.values({
					id: submissionId,
					bountyId,
					nodeId: solverId,
					diff: "+fix",
					explanation: "Fixed the bug",
					filesChanged: ["file.ts"],
					solverBackend: "test",
					solveDurationMs: 5000,
				})
				.run();

			return { solverId, bountyId, submissionId };
		}

		it("returns pendingReview over pendingBounty when both available", async () => {
			const { submissionId } = createSolverWithSubmission();

			// Create a second bounty that's queued (available for solving)
			db.insert(schema.bounties)
				.values({
					id: generateId("bty"),
					owner: "org2",
					repo: "repo2",
					issueNumber: 2,
					issueTitle: "Another bug",
					issueBody: "Also broken",
					labels: [],
					status: "queued",
				})
				.run();

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
			const { solverId } = createSolverWithSubmission();

			// Get the solver's apiKey from DB
			const solverNode = db.select().from(schema.nodes).where(eq(schema.nodes.id, solverId)).get();

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
			const { bountyId } = createSolverWithSubmission();

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
			const bounty = db
				.select()
				.from(schema.bounties)
				.where(eq(schema.bounties.id, bountyId))
				.get();
			expect(bounty?.status).toBe("in_review");
		});

		it("returns pendingBounty when no reviews pending", async () => {
			// Only a queued bounty, no submissions
			db.insert(schema.bounties)
				.values({
					id: generateId("bty"),
					owner: "org",
					repo: "repo",
					issueNumber: 1,
					issueTitle: "Solo bug",
					issueBody: "Just a bounty",
					labels: [],
					status: "queued",
				})
				.run();

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
