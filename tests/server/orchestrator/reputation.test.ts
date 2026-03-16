import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function insertNode(
	db: ReturnType<typeof drizzle>,
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
	db.insert(schema.nodes).values(node).run();
	return node;
}

describe("reputation", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
	});

	describe("applyReputationEvent", () => {
		it("increases score on fix_merged", () => {
			const node = insertNode(db, { reputationScore: 50 });
			applyReputationEvent(db, node.id, "fix_merged");
			expect(getReputation(db, node.id)).toBe(55);
		});

		it("decreases score on fix_closed", () => {
			const node = insertNode(db, { reputationScore: 50 });
			applyReputationEvent(db, node.id, "fix_closed");
			expect(getReputation(db, node.id)).toBe(47);
		});

		it("increases score on review_accurate", () => {
			const node = insertNode(db, { reputationScore: 50 });
			applyReputationEvent(db, node.id, "review_accurate");
			expect(getReputation(db, node.id)).toBe(52);
		});

		it("decreases score on review_inaccurate", () => {
			const node = insertNode(db, { reputationScore: 50 });
			applyReputationEvent(db, node.id, "review_inaccurate");
			expect(getReputation(db, node.id)).toBe(48.5);
		});

		it("clamps at 0", () => {
			const node = insertNode(db, { reputationScore: 1 });
			applyReputationEvent(db, node.id, "fix_closed");
			expect(getReputation(db, node.id)).toBe(0);
		});

		it("clamps at 100", () => {
			const node = insertNode(db, { reputationScore: 98 });
			applyReputationEvent(db, node.id, "fix_merged");
			expect(getReputation(db, node.id)).toBe(100);
		});
	});

	describe("applyDailyDecay", () => {
		it("decays high scores toward 50", () => {
			const node = insertNode(db, { reputationScore: 80 });
			applyDailyDecay(db);
			const newScore = getReputation(db, node.id);
			expect(newScore).toBeGreaterThan(50);
			expect(newScore).toBeLessThan(80);
		});

		it("increases low scores toward 50", () => {
			const node = insertNode(db, { reputationScore: 20 });
			applyDailyDecay(db);
			const newScore = getReputation(db, node.id);
			expect(newScore).toBeGreaterThan(20);
			expect(newScore).toBeLessThan(50);
		});

		it("keeps 50 unchanged", () => {
			const node = insertNode(db, { reputationScore: 50 });
			applyDailyDecay(db);
			expect(getReputation(db, node.id)).toBe(50);
		});
	});

	describe("isSuspended", () => {
		it("returns true below threshold", () => {
			const node = insertNode(db, { reputationScore: 5 });
			expect(isSuspended(db, node.id)).toBe(true);
		});

		it("returns false above threshold", () => {
			const node = insertNode(db, { reputationScore: 50 });
			expect(isSuspended(db, node.id)).toBe(false);
		});
	});

	describe("isOnProbation", () => {
		it("returns true for new nodes", () => {
			const node = insertNode(db, { totalBountiesSolved: 0 });
			expect(isOnProbation(db, node.id)).toBe(true);
		});

		it("returns false after enough merges", () => {
			const node = insertNode(db, { totalBountiesSolved: 5 });
			expect(isOnProbation(db, node.id)).toBe(false);
		});
	});

	describe("getConsensusRequirement", () => {
		it("requires 3-of-3 for probation nodes", () => {
			const node = insertNode(db, { totalBountiesSolved: 2 });
			expect(getConsensusRequirement(db, node.id)).toBe(3);
		});

		it("requires 2-of-3 for established nodes", () => {
			const node = insertNode(db, { totalBountiesSolved: 10 });
			expect(getConsensusRequirement(db, node.id)).toBe(2);
		});
	});
});
