import { createApp } from "@fairygitmother/server/app.js";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

describe("stats API", () => {
	let db: TestDb;
	let app: ReturnType<typeof createApp>;

	beforeEach(async () => {
		db = createTestDb();
		app = createApp(db);
		await cleanAllTables(db);
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
