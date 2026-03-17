import { generateApiKey, generateId } from "@fairygitmother/core";
import * as schema from "@fairygitmother/server/db/schema.js";
import {
	dequeueForNode,
	getQueueDepth,
	markAssigned,
	requeue,
} from "@fairygitmother/server/orchestrator/queue.js";
import { eq } from "drizzle-orm";
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

async function insertBounty(
	db: ReturnType<typeof createTestDb>,
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

async function insertNode(
	db: ReturnType<typeof createTestDb>,
	overrides: Partial<typeof schema.nodes.$inferInsert> = {},
) {
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
	let db: ReturnType<typeof createTestDb>;

	beforeEach(async () => {
		db = createTestDb();
		// Clean tables for test isolation
		await db.delete(schema.auditLog);
		await db.delete(schema.consensusResults);
		await db.delete(schema.votes);
		await db.delete(schema.submissions);
		await db.delete(schema.bounties);
		await db.delete(schema.nodes);
		await db.delete(schema.repos);
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
