import * as schema from "@fairygitmother/server/db/schema.js";
import {
	findNodeByApiKey,
	getActiveNodeCount,
	getNode,
	heartbeat,
	matchBountyToNode,
	pruneStaleNodes,
	registerNode,
	removeNode,
} from "@fairygitmother/server/orchestrator/registry.js";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

describe("registry", () => {
	let db: TestDb;

	beforeEach(async () => {
		db = createTestDb();
		await cleanAllTables(db);
	});

	describe("registerNode", () => {
		it("creates a node with API key", async () => {
			const result = await registerNode(
				db,
				"TestNode",
				{ languages: ["TypeScript"], tools: [] },
				"openclaw",
			);
			expect(result.id).toMatch(/^node_/);
			expect(result.apiKey).toMatch(/^mf_/);

			const node = await getNode(db, result.id);
			expect(node?.displayName).toBe("TestNode");
			expect(node?.solverBackend).toBe("openclaw");
			expect(node?.reputationScore).toBe(50);
		});
	});

	describe("findNodeByApiKey", () => {
		it("finds registered node", async () => {
			const result = await registerNode(db, null, { languages: [], tools: [] }, "test");
			const found = await findNodeByApiKey(db, result.apiKey);
			expect(found?.id).toBe(result.id);
		});

		it("returns undefined for unknown key", async () => {
			expect(await findNodeByApiKey(db, "mf_nonexistent")).toBeUndefined();
		});
	});

	describe("heartbeat", () => {
		it("updates status and timestamp", async () => {
			const result = await registerNode(db, null, { languages: [], tools: [] }, "test");
			await heartbeat(db, result.id, "busy", 100);

			const node = await getNode(db, result.id);
			expect(node?.status).toBe("busy");
		});
	});

	describe("removeNode", () => {
		it("sets status to offline", async () => {
			const result = await registerNode(db, null, { languages: [], tools: [] }, "test");
			await removeNode(db, result.id);

			const node = await getNode(db, result.id);
			expect(node?.status).toBe("offline");
		});
	});

	describe("matchBountyToNode", () => {
		it("returns idle node matching language", async () => {
			await registerNode(db, "TSNode", { languages: ["TypeScript"], tools: [] }, "test");
			const match = await matchBountyToNode(db, "TypeScript");
			expect(match).not.toBeNull();
		});

		it("returns null when no idle nodes", async () => {
			const result = await registerNode(db, null, { languages: [], tools: [] }, "test");
			await heartbeat(db, result.id, "busy", 0);
			expect(await matchBountyToNode(db, "TypeScript")).toBeNull();
		});

		it("prefers higher reputation nodes", async () => {
			const low = await registerNode(db, "LowRep", { languages: [], tools: [] }, "test");
			const high = await registerNode(db, "HighRep", { languages: [], tools: [] }, "test");
			// Manually set reputation
			await db
				.update(schema.nodes)
				.set({ reputationScore: 80 })
				.where(eq(schema.nodes.id, high.id));
			await db.update(schema.nodes).set({ reputationScore: 20 }).where(eq(schema.nodes.id, low.id));

			const match = await matchBountyToNode(db, null);
			expect(match).toBe(high.id);
		});
	});

	describe("pruneStaleNodes", () => {
		it("sets stale nodes to offline", async () => {
			const result = await registerNode(db, null, { languages: [], tools: [] }, "test");
			// Set heartbeat to 5 minutes ago
			const oldTime = new Date(Date.now() - 300_000).toISOString();
			await db
				.update(schema.nodes)
				.set({ lastHeartbeat: oldTime })
				.where(eq(schema.nodes.id, result.id));

			const pruned = await pruneStaleNodes(db, 120_000); // 2 min timeout
			expect(pruned).toBe(1);
			expect((await getNode(db, result.id))?.status).toBe("offline");
		});

		it("keeps fresh nodes active", async () => {
			await registerNode(db, null, { languages: [], tools: [] }, "test");
			const pruned = await pruneStaleNodes(db, 120_000);
			expect(pruned).toBe(0);
		});
	});

	describe("getActiveNodeCount", () => {
		it("counts non-offline nodes", async () => {
			await registerNode(db, "A", { languages: [], tools: [] }, "test");
			await registerNode(db, "B", { languages: [], tools: [] }, "test");
			const c = await registerNode(db, "C", { languages: [], tools: [] }, "test");
			await removeNode(db, c.id);

			expect(await getActiveNodeCount(db)).toBe(2);
		});
	});
});
