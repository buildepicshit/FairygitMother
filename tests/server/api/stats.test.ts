import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";

const TEST_DB_URL =
	process.env.DATABASE_URL ??
	"postgresql://fgmadmin:FgM_2026!SecureDb@fgm-db.postgres.database.azure.com:5432/fairygitmother?sslmode=require";

function createTestDb() {
	const pool = new pg.Pool({
		connectionString: TEST_DB_URL,
		ssl: TEST_DB_URL.includes("azure") ? { rejectUnauthorized: false } : undefined,
		max: 5,
	});
	return drizzle(pool, { schema });
}

describe("stats API", () => {
	let db: ReturnType<typeof createTestDb>;
	let app: ReturnType<typeof createApp>;

	beforeEach(async () => {
		db = createTestDb();
		app = createApp(db);
		// Clean tables for test isolation
		await db.delete(schema.auditLog);
		await db.delete(schema.consensusResults);
		await db.delete(schema.votes);
		await db.delete(schema.submissions);
		await db.delete(schema.bounties);
		await db.delete(schema.nodes);
		await db.delete(schema.repos);
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
