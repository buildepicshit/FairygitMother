import { generateId } from "@fairygitmother/core";
import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
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

describe("bounties API", () => {
	let db: TestDb;
	let app: ReturnType<typeof createApp>;

	beforeEach(async () => {
		db = createTestDb();
		app = createApp(db);
		await cleanAllTables(db);
	});

	describe("POST /api/v1/bounties", () => {
		it("creates a bounty from submission", async () => {
			const res = await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					owner: "testorg",
					repo: "testrepo",
					issueNumber: 42,
					issueTitle: "Fix the bug",
					issueBody: "The bug is bad",
					labels: ["good first issue"],
					language: "TypeScript",
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.bountyId).toMatch(/^bty_/);
			expect(body.status).toBe("queued");
		});

		it("rejects duplicate bounty", async () => {
			const bountyData = {
				owner: "testorg",
				repo: "testrepo",
				issueNumber: 42,
				issueTitle: "Fix the bug",
			};

			await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(bountyData),
			});

			const res = await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(bountyData),
			});

			expect(res.status).toBe(409);
		});

		it("rejects invalid request", async () => {
			const res = await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ owner: "" }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/v1/bounties", () => {
		it("returns empty list", async () => {
			const res = await app.request("/api/v1/bounties");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.bounties).toEqual([]);
		});

		it("returns created bounties", async () => {
			await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					owner: "org",
					repo: "repo",
					issueNumber: 1,
					issueTitle: "Bug 1",
				}),
			});

			const res = await app.request("/api/v1/bounties");
			const body = await res.json();
			expect(body.bounties.length).toBe(1);
			expect(body.bounties[0].issueTitle).toBe("Bug 1");
		});
	});

	describe("POST /api/v1/bounties/claim", () => {
		it("claims a bounty for a registered node", async () => {
			const { apiKey } = await registerNode(app);

			// Create a bounty (public endpoint)
			await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					owner: "org",
					repo: "repo",
					issueNumber: 1,
					issueTitle: "Bug",
				}),
			});

			// Claim (authenticated)
			const claimRes = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ apiKey }),
			});

			const body = await claimRes.json();
			expect(body.bounty).not.toBeNull();
			expect(body.bounty.issueTitle).toBe("Bug");
		});

		it("returns null when no bounties available", async () => {
			const { apiKey } = await registerNode(app);

			const claimRes = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ apiKey }),
			});

			const body = await claimRes.json();
			expect(body.bounty).toBeNull();
		});

		it("rejects without auth", async () => {
			const res = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(401);
		});
	});

	describe("POST /api/v1/bounties/:id/submit", () => {
		it("rejects unsafe diff", async () => {
			const { nodeId, apiKey } = await registerNode(app);

			// Create a bounty directly in DB
			const bountyId = generateId("bty");
			await db.insert(schema.bounties).values({
				id: bountyId,
				owner: "org",
				repo: "repo",
				issueNumber: 1,
				issueTitle: "Bug",
				issueBody: "",
				labels: [],
				status: "assigned",
				assignedNodeId: nodeId,
			});

			const res = await app.request(`/api/v1/bounties/${bountyId}/submit`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					diff: '+const secret = "sk-12345678901234567890"',
					explanation: "Fixed",
					filesChanged: ["config.ts"],
					solverBackend: "test",
					solveDurationMs: 5000,
				}),
			});

			expect(res.status).toBe(422);
			const body = await res.json();
			expect(body.status).toBe("rejected_safety");
		});

		it("rejects submission from non-assigned node", async () => {
			const solver = await registerNode(app);
			const other = await registerNode(app);

			const bountyId = generateId("bty");
			await db.insert(schema.bounties).values({
				id: bountyId,
				owner: "org",
				repo: "repo",
				issueNumber: 2,
				issueTitle: "Bug 2",
				issueBody: "",
				labels: [],
				status: "assigned",
				assignedNodeId: solver.nodeId,
			});

			const res = await app.request(`/api/v1/bounties/${bountyId}/submit`, {
				method: "POST",
				headers: authHeaders(other.apiKey),
				body: JSON.stringify({
					diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
					explanation: "Fixed",
					filesChanged: ["file.ts"],
					solverBackend: "test",
					solveDurationMs: 5000,
				}),
			});

			expect(res.status).toBe(403);
		});
	});
});
