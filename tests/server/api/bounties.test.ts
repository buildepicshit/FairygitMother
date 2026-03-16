import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@fairygitmother/server/db/schema.js";
import { createApp } from "@fairygitmother/server/app.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateId, generateApiKey } from "@fairygitmother/core";

function createTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const migration = readFileSync(resolve(import.meta.dirname, "../../../migrations/0001_initial.sql"), "utf-8");
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

describe("bounties API", () => {
	let db: ReturnType<typeof createTestDb>;
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		db = createTestDb();
		app = createApp(db);
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
			const { nodeId, apiKey } = await registerNode(app);

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
				headers: authHeaders(apiKey),
				body: JSON.stringify({}),
			});

			const body = await claimRes.json();
			expect(body.bounty).not.toBeNull();
			expect(body.bounty.issueTitle).toBe("Bug");
		});

		it("returns null when no bounties available", async () => {
			const { apiKey } = await registerNode(app);

			const claimRes = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({}),
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
			db.insert(schema.bounties).values({
				id: bountyId,
				owner: "org",
				repo: "repo",
				issueNumber: 1,
				issueTitle: "Bug",
				issueBody: "",
				labels: [],
				status: "assigned",
				assignedNodeId: nodeId,
			}).run();

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
	});
});
