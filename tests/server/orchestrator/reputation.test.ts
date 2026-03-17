import { generateApiKey, generateId } from "@fairygitmother/core";
import * as schema from "@fairygitmother/server/db/schema.js";
import {
	applyDailyDecay,
	applyReputationEvent,
	getConsensusRequirement,
	getReputation,
	isOnProbation,
	isSuspended,
} from "@fairygitmother/server/orchestrator/reputation.js";
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

async function insertNode(
	db: ReturnType<typeof createTestDb>,
	overrides: Partial<typeof schema.nodes.$inferInsert> = {},
) {
	const node = {
		id: generateId("node"),
		apiKey: generateApiKey(),
		capabilities: { languages: [], tools: [] },
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

describe("reputation", () => {
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

	describe("applyReputationEvent", () => {
		it("increases score on fix_merged", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			await applyReputationEvent(db, node.id, "fix_merged");
			expect(await getReputation(db, node.id)).toBe(55);
		});

		it("decreases score on fix_closed", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			await applyReputationEvent(db, node.id, "fix_closed");
			expect(await getReputation(db, node.id)).toBe(47);
		});

		it("increases score on review_accurate", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			await applyReputationEvent(db, node.id, "review_accurate");
			expect(await getReputation(db, node.id)).toBe(52);
		});

		it("decreases score on review_inaccurate", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			await applyReputationEvent(db, node.id, "review_inaccurate");
			expect(await getReputation(db, node.id)).toBe(48.5);
		});

		it("clamps at 0", async () => {
			const node = await insertNode(db, { reputationScore: 1 });
			await applyReputationEvent(db, node.id, "fix_closed");
			expect(await getReputation(db, node.id)).toBe(0);
		});

		it("clamps at 100", async () => {
			const node = await insertNode(db, { reputationScore: 98 });
			await applyReputationEvent(db, node.id, "fix_merged");
			expect(await getReputation(db, node.id)).toBe(100);
		});
	});

	describe("applyDailyDecay", () => {
		it("decays high scores toward 50", async () => {
			const node = await insertNode(db, { reputationScore: 80 });
			await applyDailyDecay(db);
			const newScore = await getReputation(db, node.id);
			expect(newScore).toBeGreaterThan(50);
			expect(newScore).toBeLessThan(80);
		});

		it("increases low scores toward 50", async () => {
			const node = await insertNode(db, { reputationScore: 20 });
			await applyDailyDecay(db);
			const newScore = await getReputation(db, node.id);
			expect(newScore).toBeGreaterThan(20);
			expect(newScore).toBeLessThan(50);
		});

		it("keeps 50 unchanged", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			await applyDailyDecay(db);
			expect(await getReputation(db, node.id)).toBe(50);
		});
	});

	describe("isSuspended", () => {
		it("returns true below threshold", async () => {
			const node = await insertNode(db, { reputationScore: 5 });
			expect(await isSuspended(db, node.id)).toBe(true);
		});

		it("returns false above threshold", async () => {
			const node = await insertNode(db, { reputationScore: 50 });
			expect(await isSuspended(db, node.id)).toBe(false);
		});
	});

	describe("isOnProbation", () => {
		it("returns true for new nodes", async () => {
			const node = await insertNode(db, { totalBountiesSolved: 0 });
			expect(await isOnProbation(db, node.id)).toBe(true);
		});

		it("returns false after enough merges", async () => {
			const node = await insertNode(db, { totalBountiesSolved: 5 });
			expect(await isOnProbation(db, node.id)).toBe(false);
		});
	});

	describe("getConsensusRequirement", () => {
		it("requires 3-of-3 for probation nodes", async () => {
			const node = await insertNode(db, { totalBountiesSolved: 2 });
			expect(await getConsensusRequirement(db, node.id)).toBe(3);
		});

		it("requires 2-of-3 for established nodes", async () => {
			const node = await insertNode(db, { totalBountiesSolved: 10 });
			expect(await getConsensusRequirement(db, node.id)).toBe(2);
		});
	});
});
