import { generateApiKey, generateId } from "@fairygitmother/core";
import * as schema from "@fairygitmother/server/db/schema.js";
import {
	dequeueForNode,
	getQueueDepth,
	markAssigned,
	requeue,
} from "@fairygitmother/server/orchestrator/queue.js";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

async function insertBounty(
	db: TestDb,
	overrides: Partial<typeof schema.bounties.$inferInsert> = {},
) {
	const bounty = {
		id: generateId("bty"),
		owner: "testorg",
		repo: "testrepo",
		issueNumber: Math.floor(Math.random() * 1000),
		issueTitle: "Test issue",
		issueBody: "Fix this",
		labels: ["good first issue"],
		language: "TypeScript",
		complexityEstimate: 2,
		status: "queued",
		priority: 50,
		retryCount: 0,
		...overrides,
	};
	await db.insert(schema.bounties).values(bounty);
	return bounty;
}

async function insertNode(db: TestDb, overrides: Partial<typeof schema.nodes.$inferInsert> = {}) {
	const node = {
		id: generateId("node"),
		apiKey: generateApiKey(),
		capabilities: { languages: ["TypeScript"], tools: [] },
		solverBackend: "test",
		status: "idle",
		reputationScore: 50,
		totalTokensDonated: 0,
		totalBountiesSolved: 0,
		totalReviewsDone: 0,
		...overrides,
	};
	await db.insert(schema.nodes).values(node);
	return node;
}

describe("queue", () => {
	let db: TestDb;

	beforeEach(async () => {
		db = createTestDb();
		await cleanAllTables(db);
	});

	describe("getQueueDepth", () => {
		it("returns 0 for empty queue", async () => {
			expect(await getQueueDepth(db)).toBe(0);
		});

		it("counts queued bounties", async () => {
			await insertBounty(db);
			await insertBounty(db);
			await insertBounty(db, { status: "assigned" });
			expect(await getQueueDepth(db)).toBe(2);
		});
	});

	describe("dequeueForNode", () => {
		it("returns null when no bounties", async () => {
			const node = await insertNode(db);
			expect(await dequeueForNode(db, node.id)).toBeNull();
		});

		it("returns highest priority bounty", async () => {
			const node = await insertNode(db);
			await insertBounty(db, { priority: 100, issueTitle: "Low priority" });
			await insertBounty(db, { priority: 10, issueTitle: "High priority" });
			const result = await dequeueForNode(db, node.id);
			expect(result?.issueTitle).toBe("High priority");
		});

		it("matches language capabilities", async () => {
			const node = await insertNode(db, { capabilities: { languages: ["Python"], tools: [] } });
			await insertBounty(db, { language: "TypeScript", issueTitle: "TS issue" });
			await insertBounty(db, { language: "Python", issueTitle: "Python issue" });
			const result = await dequeueForNode(db, node.id);
			expect(result?.issueTitle).toBe("Python issue");
		});

		it("skips blacklisted repos", async () => {
			const node = await insertNode(db);
			await db.insert(schema.repos).values({
				owner: "testorg",
				name: "testrepo",
				blacklisted: true,
			});
			await insertBounty(db);
			expect(await dequeueForNode(db, node.id)).toBeNull();
		});

		it("skips bounties the node has already submitted for", async () => {
			const node = await insertNode(db);
			const attempted = await insertBounty(db, { issueTitle: "Already tried" });
			await insertBounty(db, { issueTitle: "Fresh bounty" });

			// Record a prior submission from this node for the first bounty
			await db.insert(schema.submissions).values({
				id: generateId("sub"),
				bountyId: attempted.id,
				nodeId: node.id,
				diff: "--- a/file.ts\n+++ b/file.ts",
				explanation: "Attempted fix",
				filesChanged: ["file.ts"],
				solverBackend: "test",
				solveDurationMs: 1000,
			});

			const result = await dequeueForNode(db, node.id);
			expect(result?.issueTitle).toBe("Fresh bounty");
		});

		it("allows a different node to pick up a bounty another node attempted", async () => {
			const nodeA = await insertNode(db);
			const nodeB = await insertNode(db);
			const bounty = await insertBounty(db, { issueTitle: "Shared bounty" });

			// Node A already attempted this bounty
			await db.insert(schema.submissions).values({
				id: generateId("sub"),
				bountyId: bounty.id,
				nodeId: nodeA.id,
				diff: "--- a/file.ts\n+++ b/file.ts",
				explanation: "Failed attempt",
				filesChanged: ["file.ts"],
				solverBackend: "test",
				solveDurationMs: 1000,
			});

			// Node A should NOT get it again
			expect(await dequeueForNode(db, nodeA.id)).toBeNull();
			// Node B should still get it
			const result = await dequeueForNode(db, nodeB.id);
			expect(result?.issueTitle).toBe("Shared bounty");
		});
	});

	describe("markAssigned", () => {
		it("updates bounty status and node", async () => {
			const bounty = await insertBounty(db);
			const node = await insertNode(db);
			await markAssigned(db, bounty.id, node.id);

			const updated = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bounty.id))
			)[0];
			expect(updated?.status).toBe("assigned");
			expect(updated?.assignedNodeId).toBe(node.id);
		});
	});

	describe("requeue", () => {
		it("increments retry count and resets status", async () => {
			const bounty = await insertBounty(db, { status: "assigned", retryCount: 1 });
			await requeue(db, bounty.id);

			const updated = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bounty.id))
			)[0];
			expect(updated?.status).toBe("queued");
			expect(updated?.assignedNodeId).toBeNull();
			expect(updated?.retryCount).toBe(2);
		});
	});
});
