import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@fairygitmother/server/db/schema.js";
import {
	registerNode,
	heartbeat,
	findNodeByApiKey,
	getNode,
	removeNode,
	matchBountyToNode,
	pruneStaleNodes,
	getActiveNodeCount,
} from "@fairygitmother/server/orchestrator/registry.js";
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

describe("registry", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
	});

	describe("registerNode", () => {
		it("creates a node with API key", () => {
			const result = registerNode(db, "TestNode", { languages: ["TypeScript"], tools: [] }, "openclaw");
			expect(result.id).toMatch(/^node_/);
			expect(result.apiKey).toMatch(/^mf_/);

			const node = getNode(db, result.id);
			expect(node?.displayName).toBe("TestNode");
			expect(node?.solverBackend).toBe("openclaw");
			expect(node?.reputationScore).toBe(50);
		});
	});

	describe("findNodeByApiKey", () => {
		it("finds registered node", () => {
			const result = registerNode(db, null, { languages: [], tools: [] }, "test");
			const found = findNodeByApiKey(db, result.apiKey);
			expect(found?.id).toBe(result.id);
		});

		it("returns undefined for unknown key", () => {
			expect(findNodeByApiKey(db, "mf_nonexistent")).toBeUndefined();
		});
	});

	describe("heartbeat", () => {
		it("updates status and timestamp", () => {
			const result = registerNode(db, null, { languages: [], tools: [] }, "test");
			heartbeat(db, result.id, "busy", 100);

			const node = getNode(db, result.id);
			expect(node?.status).toBe("busy");
		});
	});

	describe("removeNode", () => {
		it("sets status to offline", () => {
			const result = registerNode(db, null, { languages: [], tools: [] }, "test");
			removeNode(db, result.id);

			const node = getNode(db, result.id);
			expect(node?.status).toBe("offline");
		});
	});

	describe("matchBountyToNode", () => {
		it("returns idle node matching language", () => {
			registerNode(db, "TSNode", { languages: ["TypeScript"], tools: [] }, "test");
			const match = matchBountyToNode(db, "TypeScript");
			expect(match).not.toBeNull();
		});

		it("returns null when no idle nodes", () => {
			const result = registerNode(db, null, { languages: [], tools: [] }, "test");
			heartbeat(db, result.id, "busy", 0);
			expect(matchBountyToNode(db, "TypeScript")).toBeNull();
		});

		it("prefers higher reputation nodes", () => {
			const low = registerNode(db, "LowRep", { languages: [], tools: [] }, "test");
			const high = registerNode(db, "HighRep", { languages: [], tools: [] }, "test");
			// Manually set reputation
			db.update(schema.nodes).set({ reputationScore: 80 }).where(eq(schema.nodes.id, high.id)).run();
			db.update(schema.nodes).set({ reputationScore: 20 }).where(eq(schema.nodes.id, low.id)).run();

			const match = matchBountyToNode(db, null);
			expect(match).toBe(high.id);
		});
	});

	describe("pruneStaleNodes", () => {
		it("sets stale nodes to offline", () => {
			const result = registerNode(db, null, { languages: [], tools: [] }, "test");
			// Set heartbeat to 5 minutes ago
			const oldTime = new Date(Date.now() - 300_000).toISOString();
			db.update(schema.nodes).set({ lastHeartbeat: oldTime }).where(eq(schema.nodes.id, result.id)).run();

			const pruned = pruneStaleNodes(db, 120_000); // 2 min timeout
			expect(pruned).toBe(1);
			expect(getNode(db, result.id)?.status).toBe("offline");
		});

		it("keeps fresh nodes active", () => {
			registerNode(db, null, { languages: [], tools: [] }, "test");
			const pruned = pruneStaleNodes(db, 120_000);
			expect(pruned).toBe(0);
		});
	});

	describe("getActiveNodeCount", () => {
		it("counts non-offline nodes", () => {
			registerNode(db, "A", { languages: [], tools: [] }, "test");
			registerNode(db, "B", { languages: [], tools: [] }, "test");
			const c = registerNode(db, "C", { languages: [], tools: [] }, "test");
			removeNode(db, c.id);

			expect(getActiveNodeCount(db)).toBe(2);
		});
	});
});
