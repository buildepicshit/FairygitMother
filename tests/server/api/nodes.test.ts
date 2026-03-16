import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@fairygitmother/server/db/schema.js";
import { createApp } from "@fairygitmother/server/app.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
});
