import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import Database from "better-sqlite3";
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

describe("stats API", () => {
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		const db = createTestDb();
		app = createApp(db);
	});

	describe("GET /api/v1/stats", () => {
		it("returns grid stats", async () => {
			const res = await app.request("/api/v1/stats");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveProperty("activeNodes");
			expect(body).toHaveProperty("queueDepth");
			expect(body).toHaveProperty("totalTokensDonated");
			expect(body.activeNodes).toBe(0);
			expect(body.queueDepth).toBe(0);
		});
	});

	describe("GET /api/v1/health", () => {
		it("returns ok", async () => {
			const res = await app.request("/api/v1/health");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.status).toBe("ok");
		});
	});
});
