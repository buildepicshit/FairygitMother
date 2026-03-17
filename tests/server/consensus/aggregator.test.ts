import { generateApiKey, generateId } from "@fairygitmother/core";
import { evaluateConsensus, recordConsensus } from "@fairygitmother/server/consensus/aggregator.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

async function setupScenario(db: TestDb) {
	// Create solver node (established — 10 bounties solved for 2-of-3 requirement)
	const solverId = generateId("node");
	await db.insert(schema.nodes).values({
		id: solverId,
		apiKey: generateApiKey(),
		capabilities: { languages: [], tools: [] },
		solverBackend: "test",
		reputationScore: 50,
		totalBountiesSolved: 10,
	});

	// Create reviewer nodes
	const reviewerIds: string[] = [];
	for (let i = 0; i < 3; i++) {
		const id = generateId("node");
		await db.insert(schema.nodes).values({
			id,
			apiKey: generateApiKey(),
			capabilities: { languages: [], tools: [] },
			solverBackend: "test",
			reputationScore: 50,
			totalBountiesSolved: 10,
		});
		reviewerIds.push(id);
	}

	// Create bounty
	const bountyId = generateId("bty");
	await db.insert(schema.bounties).values({
		id: bountyId,
		owner: "org",
		repo: "project",
		issueNumber: 1,
		issueTitle: "Bug",
		issueBody: "Fix it",
		labels: [],
		status: "diff_submitted",
	});

	// Create submission
	const submissionId = generateId("sub");
	await db.insert(schema.submissions).values({
		id: submissionId,
		bountyId,
		nodeId: solverId,
		diff: "+fix",
		explanation: "Fixed",
		filesChanged: ["file.ts"],
		solverBackend: "test",
		solveDurationMs: 10000,
	});

	return { solverId, reviewerIds, bountyId, submissionId };
}

describe("consensus aggregator", () => {
	let db: TestDb;

	beforeEach(async () => {
		db = createTestDb();
		await cleanAllTables(db);
	});

	describe("evaluateConsensus", () => {
		it("returns pending with no votes", async () => {
			const { submissionId } = await setupScenario(db);
			expect(await evaluateConsensus(db, submissionId)).toBe("pending");
		});

		it("returns approved with 2 approvals (established node)", async () => {
			const { submissionId, reviewerIds } = await setupScenario(db);

			for (let i = 0; i < 2; i++) {
				await db.insert(schema.votes).values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[i],
					decision: "approve",
					reasoning: "LGTM",
					confidence: 0.9,
				});
			}

			expect(await evaluateConsensus(db, submissionId)).toBe("approved");
		});

		it("returns rejected with 2 rejections", async () => {
			const { submissionId, reviewerIds } = await setupScenario(db);

			for (let i = 0; i < 2; i++) {
				await db.insert(schema.votes).values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[i],
					decision: "reject",
					reasoning: "Wrong approach",
					confidence: 0.8,
				});
			}

			expect(await evaluateConsensus(db, submissionId)).toBe("rejected");
		});

		it("returns pending with 1 approve and 1 reject", async () => {
			const { submissionId, reviewerIds } = await setupScenario(db);

			await db.insert(schema.votes).values({
				id: generateId("vote"),
				submissionId,
				reviewerNodeId: reviewerIds[0],
				decision: "approve",
				reasoning: "Good",
				confidence: 0.9,
			});

			await db.insert(schema.votes).values({
				id: generateId("vote"),
				submissionId,
				reviewerNodeId: reviewerIds[1],
				decision: "reject",
				reasoning: "Bad",
				confidence: 0.7,
			});

			expect(await evaluateConsensus(db, submissionId)).toBe("pending");
		});
	});

	describe("recordConsensus", () => {
		it("creates consensus result and updates bounty", async () => {
			const { submissionId, bountyId, reviewerIds } = await setupScenario(db);

			// Add 2 approval votes
			for (let i = 0; i < 2; i++) {
				await db.insert(schema.votes).values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[i],
					decision: "approve",
					reasoning: "LGTM",
					confidence: 0.9,
				});
			}

			await recordConsensus(db, submissionId, "approved");

			const result = (
				await db
					.select()
					.from(schema.consensusResults)
					.where(eq(schema.consensusResults.submissionId, submissionId))
			)[0];
			expect(result?.outcome).toBe("approved");
			expect(result?.approveCount).toBe(2);

			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("approved");
		});

		it("is idempotent — skips if consensus already recorded", async () => {
			const { submissionId, reviewerIds } = await setupScenario(db);

			for (let i = 0; i < 2; i++) {
				await db.insert(schema.votes).values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[i],
					decision: "approve",
					reasoning: "LGTM",
					confidence: 0.9,
				});
			}

			await recordConsensus(db, submissionId, "approved");
			await recordConsensus(db, submissionId, "approved");

			const results = await db
				.select()
				.from(schema.consensusResults)
				.where(eq(schema.consensusResults.submissionId, submissionId));
			expect(results.length).toBe(1);
		});

		it("does not apply solver reputation at consensus time (deferred to cleanup)", async () => {
			const { submissionId, solverId, reviewerIds } = await setupScenario(db);

			for (let i = 0; i < 2; i++) {
				await db.insert(schema.votes).values({
					id: generateId("vote"),
					submissionId,
					reviewerNodeId: reviewerIds[i],
					decision: "reject",
					reasoning: "Bad fix",
					confidence: 0.8,
				});
			}

			await recordConsensus(db, submissionId, "rejected");

			// Solver reputation is NOT applied at consensus — it happens at PR merge/close in cleanup
			const solver = (await db.select().from(schema.nodes).where(eq(schema.nodes.id, solverId)))[0];
			expect(solver?.reputationScore).toBe(50);
		});
	});
});
