import { generateApiKey, generateId } from "@fairygitmother/core";
import { evaluateConsensus, recordConsensus } from "@fairygitmother/server/consensus/aggregator.js";
import * as schema from "@fairygitmother/server/db/schema.js";
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

async function setupScenario(db: ReturnType<typeof createTestDb>) {
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

		it("applies reputation on rejection", async () => {
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

			const solver = (await db.select().from(schema.nodes).where(eq(schema.nodes.id, solverId)))[0];
			expect(solver?.reputationScore).toBeLessThan(50); // fix_closed: -3
		});
	});
});
