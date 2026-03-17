import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateApiKey, generateId } from "@fairygitmother/core";
import { evaluateConsensus, recordConsensus } from "@fairygitmother/server/consensus/aggregator.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
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

function setupScenario(db: ReturnType<typeof drizzle>) {
	// Create solver node (established — 10 bounties solved for 2-of-3 requirement)
	const solverId = generateId("node");
	db.insert(schema.nodes)
		.values({
			id: solverId,
			apiKey: generateApiKey(),
			capabilities: { languages: [], tools: [] },
			solverBackend: "test",
			reputationScore: 50,
			totalBountiesSolved: 10,
		})
		.run();

	// Create reviewer nodes
	const reviewerIds = [1, 2, 3].map((_i) => {
		const id = generateId("node");
		db.insert(schema.nodes)
			.values({
				id,
				apiKey: generateApiKey(),
				capabilities: { languages: [], tools: [] },
				solverBackend: "test",
				reputationScore: 50,
				totalBountiesSolved: 10,
			})
			.run();
		return id;
	});

	// Create bounty
	const bountyId = generateId("bty");
	db.insert(schema.bounties)
		.values({
			id: bountyId,
			owner: "org",
			repo: "project",
			issueNumber: 1,
			issueTitle: "Bug",
			issueBody: "Fix it",
			labels: [],
			status: "diff_submitted",
		})
		.run();

	// Create submission
	const submissionId = generateId("sub");
	db.insert(schema.submissions)
		.values({
			id: submissionId,
			bountyId,
			nodeId: solverId,
			diff: "+fix",
			explanation: "Fixed",
			filesChanged: ["file.ts"],
			solverBackend: "test",
			solveDurationMs: 10000,
		})
		.run();

	return { solverId, reviewerIds, bountyId, submissionId };
}

describe("consensus aggregator", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
	});

	describe("evaluateConsensus", () => {
		it("returns pending with no votes", async () => {
			const { submissionId } = setupScenario(db);
			expect(await evaluateConsensus(db, submissionId)).toBe("pending");
		});

		it("returns approved with 2 approvals (established node)", async () => {
			const { submissionId, reviewerIds } = setupScenario(db);

			for (let i = 0; i < 2; i++) {
				db.insert(schema.votes)
					.values({
						id: generateId("vote"),
						submissionId,
						reviewerNodeId: reviewerIds[i],
						decision: "approve",
						reasoning: "LGTM",
						confidence: 0.9,
					})
					.run();
			}

			expect(await evaluateConsensus(db, submissionId)).toBe("approved");
		});

		it("returns rejected with 2 rejections", async () => {
			const { submissionId, reviewerIds } = setupScenario(db);

			for (let i = 0; i < 2; i++) {
				db.insert(schema.votes)
					.values({
						id: generateId("vote"),
						submissionId,
						reviewerNodeId: reviewerIds[i],
						decision: "reject",
						reasoning: "Wrong approach",
						confidence: 0.8,
					})
					.run();
			}

			expect(await evaluateConsensus(db, submissionId)).toBe("rejected");
		});

		it("returns pending with 1 approve and 1 reject", async () => {
			const { submissionId, reviewerIds } = setupScenario(db);

			db.insert(schema.votes)
				.values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[0],
					decision: "approve",
					reasoning: "Good",
					confidence: 0.9,
				})
				.run();

			db.insert(schema.votes)
				.values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[1],
					decision: "reject",
					reasoning: "Bad",
					confidence: 0.7,
				})
				.run();

			expect(await evaluateConsensus(db, submissionId)).toBe("pending");
		});
	});

	describe("recordConsensus", () => {
		it("creates consensus result and updates bounty", async () => {
			const { submissionId, bountyId, reviewerIds } = setupScenario(db);

			// Add 2 approval votes
			for (let i = 0; i < 2; i++) {
				db.insert(schema.votes)
					.values({
						id: generateId("vote"),
						submissionId,
						reviewerNodeId: reviewerIds[i],
						decision: "approve",
						reasoning: "LGTM",
						confidence: 0.9,
					})
					.run();
			}

			await recordConsensus(db, submissionId, "approved");

			const result = db
				.select()
				.from(schema.consensusResults)
				.where(eq(schema.consensusResults.submissionId, submissionId))
				.get();
			expect(result?.outcome).toBe("approved");
			expect(result?.approveCount).toBe(2);

			const bounty = db
				.select()
				.from(schema.bounties)
				.where(eq(schema.bounties.id, bountyId))
				.get();
			expect(bounty?.status).toBe("approved");
		});

		it("applies reputation on rejection", async () => {
			const { submissionId, solverId, reviewerIds } = setupScenario(db);

			for (let i = 0; i < 2; i++) {
				db.insert(schema.votes)
					.values({
						id: generateId("vote"),
						submissionId,
						reviewerNodeId: reviewerIds[i],
						decision: "reject",
						reasoning: "Bad fix",
						confidence: 0.8,
					})
					.run();
			}

			await recordConsensus(db, submissionId, "rejected");

			const solver = db.select().from(schema.nodes).where(eq(schema.nodes.id, solverId)).get();
			expect(solver?.reputationScore).toBeLessThan(50); // fix_closed: -3
		});
	});
});
