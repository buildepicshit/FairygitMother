import { createApp } from "@fairygitmother/server/app.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";

// ── Test helpers ────────────────────────────────────────────────

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

type TestDb = ReturnType<typeof createTestDb>;
type TestApp = ReturnType<typeof createApp>;

async function registerNode(
	app: TestApp,
	name?: string,
): Promise<{ nodeId: string; apiKey: string }> {
	const res = await app.request("/api/v1/nodes/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			displayName: name ?? null,
			capabilities: { languages: [], tools: [] },
			solverBackend: "test",
		}),
	});
	expect(res.status).toBe(201);
	return res.json() as Promise<{ nodeId: string; apiKey: string }>;
}

function authHeaders(apiKey: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
	};
}

async function submitBounty(
	app: TestApp,
	overrides?: Partial<{
		owner: string;
		repo: string;
		issueNumber: number;
		issueTitle: string;
		issueBody: string;
		labels: string[];
		language: string;
	}>,
): Promise<{ bountyId: string; status: string }> {
	const res = await app.request("/api/v1/bounties", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			owner: "testorg",
			repo: "testrepo",
			issueNumber: 1,
			issueTitle: "Fix the bug",
			issueBody: "Something is broken",
			labels: ["good first issue"],
			language: "TypeScript",
			...overrides,
		}),
	});
	expect(res.status).toBe(201);
	return res.json() as Promise<{ bountyId: string; status: string }>;
}

async function claimBounty(
	app: TestApp,
	apiKey: string,
): Promise<{ bounty: Record<string, unknown> | null }> {
	const res = await app.request("/api/v1/bounties/claim", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apiKey }),
	});
	expect(res.status).toBe(200);
	return res.json() as Promise<{ bounty: Record<string, unknown> | null }>;
}

async function submitFix(
	app: TestApp,
	bountyId: string,
	apiKey: string,
	diff?: string,
): Promise<Response> {
	return app.request(`/api/v1/bounties/${bountyId}/submit`, {
		method: "POST",
		headers: authHeaders(apiKey),
		body: JSON.stringify({
			diff: diff ?? "--- a/src/fix.ts\n+++ b/src/fix.ts\n@@ -1 +1 @@\n-broken\n+fixed",
			explanation: "Fixed the bug by correcting the logic",
			filesChanged: ["src/fix.ts"],
			testsPassed: true,
			tokensUsed: 1500,
			solverBackend: "test",
			solveDurationMs: 5000,
		}),
	});
}

async function submitVote(
	app: TestApp,
	submissionId: string,
	apiKey: string,
	decision: "approve" | "reject",
): Promise<Response> {
	return app.request(`/api/v1/reviews/${submissionId}/vote`, {
		method: "POST",
		headers: authHeaders(apiKey),
		body: JSON.stringify({
			decision,
			reasoning:
				decision === "approve" ? "Clean fix, tests pass, no issues" : "Code introduces regressions",
			issuesFound: decision === "reject" ? ["regression in edge case"] : [],
			confidence: 0.9,
			testsRun: true,
		}),
	});
}

/**
 * Take a solver off probation so 2-of-3 consensus is enough.
 * New nodes need 3-of-3 (first 5 merges). This bypasses that for simpler tests.
 */
async function liftProbation(db: TestDb, nodeId: string) {
	await db.update(schema.nodes).set({ totalBountiesSolved: 5 }).where(eq(schema.nodes.id, nodeId));
}

// ── Tests ───────────────────────────────────────────────────────

describe("E2E: FairygitMother bounty lifecycle", () => {
	let db: TestDb;
	let app: TestApp;

	beforeEach(async () => {
		db = createTestDb();
		app = createApp(db);
		// Clean tables for test isolation
		await db.delete(schema.auditLog);
		await db.delete(schema.consensusResults);
		await db.delete(schema.votes);
		await db.delete(schema.submissions);
		await db.delete(schema.bounties);
		await db.delete(schema.nodes);
		await db.delete(schema.repos);
	});

	// ── 1. Full lifecycle: submit -> claim -> fix -> review -> consensus -> approved ──

	describe("full lifecycle: submit -> claim -> fix -> review -> consensus -> approved", () => {
		it("completes a bounty through the entire pipeline", async () => {
			// Register 3 nodes: 1 solver + 2 reviewers
			const solver = await registerNode(app, "solver-node");
			const reviewer1 = await registerNode(app, "reviewer-1");
			const reviewer2 = await registerNode(app, "reviewer-2");

			// Lift probation for solver so 2-of-3 consensus works
			await liftProbation(db, solver.nodeId);

			// Submit a bounty (public endpoint, no auth)
			const { bountyId } = await submitBounty(app);
			expect(bountyId).toMatch(/^bty_/);

			// Verify bounty is queued
			const listRes = await app.request("/api/v1/bounties?status=queued");
			const listBody = (await listRes.json()) as { bounties: Array<{ id: string }> };
			expect(listBody.bounties.some((b) => b.id === bountyId)).toBe(true);

			// Solver claims the bounty
			const claimResult = await claimBounty(app, solver.apiKey);
			expect(claimResult.bounty).not.toBeNull();
			expect(claimResult.bounty?.issueTitle).toBe("Fix the bug");

			// Verify bounty is now assigned
			const assignedBounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(assignedBounty?.status).toBe("assigned");
			expect(assignedBounty?.assignedNodeId).toBe(solver.nodeId);

			// Solver submits a clean fix
			const fixRes = await submitFix(app, bountyId, solver.apiKey);
			expect(fixRes.status).toBe(201);
			const fixBody = (await fixRes.json()) as {
				submissionId: string;
				status: string;
			};
			expect(fixBody.submissionId).toMatch(/^sub_/);
			expect(fixBody.status).toBe("accepted");

			const submissionId = fixBody.submissionId;

			// Verify bounty moved to diff_submitted
			const afterSubmit = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(afterSubmit?.status).toBe("diff_submitted");

			// Reviewer 1 votes approve
			const vote1Res = await submitVote(app, submissionId, reviewer1.apiKey, "approve");
			expect(vote1Res.status).toBe(200);
			const vote1Body = (await vote1Res.json()) as {
				accepted: boolean;
				consensusStatus: string;
			};
			expect(vote1Body.accepted).toBe(true);
			// After 1 approval, not yet consensus (need 2)
			expect(vote1Body.consensusStatus).toBe("pending");

			// Verify bounty transitioned to in_review after first vote
			const afterFirstVote = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(afterFirstVote?.status).toBe("in_review");

			// Reviewer 2 votes approve -- this should trigger consensus
			const vote2Res = await submitVote(app, submissionId, reviewer2.apiKey, "approve");
			expect(vote2Res.status).toBe(200);
			const vote2Body = (await vote2Res.json()) as {
				accepted: boolean;
				consensusStatus: string;
			};
			expect(vote2Body.accepted).toBe(true);
			expect(vote2Body.consensusStatus).toBe("approved");

			// Verify bounty status is now "approved"
			const finalBounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(finalBounty?.status).toBe("approved");

			// Verify consensus result was recorded
			const consensusRow = (
				await db
					.select()
					.from(schema.consensusResults)
					.where(eq(schema.consensusResults.submissionId, submissionId))
			)[0];
			expect(consensusRow).toBeDefined();
			expect(consensusRow?.outcome).toBe("approved");
			expect(consensusRow?.approveCount).toBe(2);
			expect(consensusRow?.rejectCount).toBe(0);
			expect(consensusRow?.totalVotes).toBe(2);

			// Verify solver reputation increased (+5 for fix_merged)
			const solverNode = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, solver.nodeId))
			)[0];
			expect(solverNode?.reputationScore).toBe(55); // 50 + 5
			expect(solverNode?.totalBountiesSolved).toBe(6); // 5 (lifted) + 1

			// Verify reviewer stats updated
			const r1Node = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, reviewer1.nodeId))
			)[0];
			expect(r1Node?.totalReviewsDone).toBe(1);
			// Accurate review: +2 reputation
			expect(r1Node?.reputationScore).toBe(52);

			// Verify stats endpoint reflects the changes
			const statsRes = await app.request("/api/v1/stats");
			expect(statsRes.status).toBe(200);
			const stats = (await statsRes.json()) as {
				activeNodes: number;
				totalNodes: number;
				queueDepth: number;
				prsSubmittedAllTime: number;
				totalTokensDonated: number;
				averageSolveTimeMs: number;
				mergeRate: number;
			};
			expect(stats.totalNodes).toBe(3);
			expect(stats.activeNodes).toBe(3);
			expect(stats.queueDepth).toBe(0);
			expect(stats.prsSubmittedAllTime).toBe(1);
			expect(stats.averageSolveTimeMs).toBe(5000);
			expect(stats.mergeRate).toBe(1); // 1 approved / 1 decided
		});
	});

	// ── 2. Rejection flow: 2 rejections = immediate reject ──

	describe("rejection flow: 2 rejections = immediate reject", () => {
		it("rejects bounty when 2 reviewers vote reject", async () => {
			const solver = await registerNode(app, "solver");
			const reviewer1 = await registerNode(app, "reviewer-1");
			const reviewer2 = await registerNode(app, "reviewer-2");
			await liftProbation(db, solver.nodeId);

			const { bountyId } = await submitBounty(app, { issueNumber: 10 });
			await claimBounty(app, solver.apiKey);

			const fixRes = await submitFix(app, bountyId, solver.apiKey);
			const { submissionId } = (await fixRes.json()) as { submissionId: string };

			// Both reviewers vote reject
			const vote1Res = await submitVote(app, submissionId, reviewer1.apiKey, "reject");
			const vote1Body = (await vote1Res.json()) as { consensusStatus: string };
			expect(vote1Body.consensusStatus).toBe("pending"); // 1 reject not enough

			// Verify bounty transitioned to in_review after first vote
			const afterFirstVote = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(afterFirstVote?.status).toBe("in_review");

			const vote2Res = await submitVote(app, submissionId, reviewer2.apiKey, "reject");
			const vote2Body = (await vote2Res.json()) as { consensusStatus: string };
			expect(vote2Body.consensusStatus).toBe("rejected"); // 2 rejections = immediate reject

			// Verify bounty status
			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("rejected");

			// Verify consensus result
			const consensusRow = (
				await db
					.select()
					.from(schema.consensusResults)
					.where(eq(schema.consensusResults.submissionId, submissionId))
			)[0];
			expect(consensusRow?.outcome).toBe("rejected");
			expect(consensusRow?.rejectCount).toBe(2);

			// Verify solver reputation decreased (-3 for fix_closed)
			const solverNode = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, solver.nodeId))
			)[0];
			expect(solverNode?.reputationScore).toBe(47); // 50 - 3

			// Verify reviewers got accurate review bonus (+2)
			const r1 = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, reviewer1.nodeId))
			)[0];
			expect(r1?.reputationScore).toBe(52); // 50 + 2
		});
	});

	// ── 3. Safety rejection: malicious diff blocked ──

	describe("safety rejection: malicious diff blocked", () => {
		it("returns 422 when diff contains eval()", async () => {
			const solver = await registerNode(app, "solver");
			const { bountyId } = await submitBounty(app, { issueNumber: 20 });
			await claimBounty(app, solver.apiKey);

			const maliciousDiff = [
				"--- a/src/handler.ts",
				"+++ b/src/handler.ts",
				"@@ -1,3 +1,3 @@",
				"-const result = safeFunction(input);",
				"+const result = eval(userInput);",
			].join("\n");

			const res = await submitFix(app, bountyId, solver.apiKey, maliciousDiff);
			expect(res.status).toBe(422);

			const body = (await res.json()) as {
				submissionId: null;
				status: string;
				safetyIssues: string[];
			};
			expect(body.status).toBe("rejected_safety");
			expect(body.submissionId).toBeNull();
			expect(body.safetyIssues.length).toBeGreaterThan(0);
			expect(body.safetyIssues.some((i: string) => i.includes("eval"))).toBe(true);
		});

		it("returns 422 when diff contains secret patterns", async () => {
			const solver = await registerNode(app, "solver");
			const { bountyId } = await submitBounty(app, { issueNumber: 21 });
			await claimBounty(app, solver.apiKey);

			const secretDiff = '+const secret = "my-super-secret-value"';

			const res = await submitFix(app, bountyId, solver.apiKey, secretDiff);
			expect(res.status).toBe(422);

			const body = (await res.json()) as { status: string; safetyIssues: string[] };
			expect(body.status).toBe("rejected_safety");
		});

		it("returns 422 when diff contains child_process", async () => {
			const solver = await registerNode(app, "solver");
			const { bountyId } = await submitBounty(app, { issueNumber: 22 });
			await claimBounty(app, solver.apiKey);

			const dangerousDiff = [
				"--- a/src/util.ts",
				"+++ b/src/util.ts",
				"@@ -1 +1,2 @@",
				'+import { exec } from "child_process";',
				"+exec('rm -rf /')",
			].join("\n");

			const res = await submitFix(app, bountyId, solver.apiKey, dangerousDiff);
			expect(res.status).toBe(422);
		});
	});

	// ── 4. Auth enforcement ──

	describe("auth enforcement", () => {
		it("returns 401 for POST /bounties/claim without auth", async () => {
			const res = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(401);
		});

		it("returns 401 for POST /bounties/:id/submit without auth", async () => {
			const res = await app.request("/api/v1/bounties/fake-id/submit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					diff: "some diff",
					explanation: "explanation",
					filesChanged: ["file.ts"],
					solverBackend: "test",
					solveDurationMs: 1000,
				}),
			});
			expect(res.status).toBe(401);
		});

		it("returns 401 for POST /reviews/:id/vote without auth", async () => {
			const res = await app.request("/api/v1/reviews/fake-id/vote", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					decision: "approve",
					reasoning: "looks good",
					confidence: 0.9,
					testsRun: true,
				}),
			});
			expect(res.status).toBe(401);
		});

		it("returns 401 with invalid API key", async () => {
			const res = await app.request("/api/v1/bounties/claim", {
				method: "POST",
				headers: authHeaders("invalid-key-that-does-not-exist"),
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(401);
		});

		it("allows GET /bounties without auth (public)", async () => {
			const res = await app.request("/api/v1/bounties");
			expect(res.status).toBe(200);
			const body = (await res.json()) as { bounties: unknown[] };
			expect(body.bounties).toEqual([]);
		});

		it("allows POST /bounties without auth (maintainer submission)", async () => {
			const res = await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					owner: "testorg",
					repo: "testrepo",
					issueNumber: 99,
					issueTitle: "Public submission",
				}),
			});
			expect(res.status).toBe(201);
		});

		it("allows GET /stats without auth (public)", async () => {
			const res = await app.request("/api/v1/stats");
			expect(res.status).toBe(200);
		});
	});

	// ── 5. Node lifecycle ──

	describe("node lifecycle", () => {
		it("register -> heartbeat idle -> heartbeat busy -> delete -> stats reflect changes", async () => {
			// Verify initial stats: no nodes
			const stats0 = (await (await app.request("/api/v1/stats")).json()) as {
				totalNodes: number;
				activeNodes: number;
			};
			expect(stats0.totalNodes).toBe(0);
			expect(stats0.activeNodes).toBe(0);

			// Register a node
			const { nodeId, apiKey } = await registerNode(app, "lifecycle-node");

			// Stats should show 1 active node
			const stats1 = (await (await app.request("/api/v1/stats")).json()) as {
				totalNodes: number;
				activeNodes: number;
			};
			expect(stats1.totalNodes).toBe(1);
			expect(stats1.activeNodes).toBe(1);

			// Heartbeat as idle
			const hbIdleRes = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 100,
				}),
			});
			expect(hbIdleRes.status).toBe(200);
			const hbIdleBody = (await hbIdleRes.json()) as { acknowledged: boolean };
			expect(hbIdleBody.acknowledged).toBe(true);

			// Verify node status is idle
			const nodeAfterIdle = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, nodeId))
			)[0];
			expect(nodeAfterIdle?.status).toBe("idle");
			expect(nodeAfterIdle?.totalTokensDonated).toBe(100);

			// Heartbeat as busy
			const hbBusyRes = await app.request(`/api/v1/nodes/${nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(apiKey),
				body: JSON.stringify({
					status: "busy",
					tokensUsedSinceLastHeartbeat: 500,
				}),
			});
			expect(hbBusyRes.status).toBe(200);

			const nodeAfterBusy = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, nodeId))
			)[0];
			expect(nodeAfterBusy?.status).toBe("busy");
			expect(nodeAfterBusy?.totalTokensDonated).toBe(600); // 100 + 500

			// Delete node
			const deleteRes = await app.request(`/api/v1/nodes/${nodeId}`, {
				method: "DELETE",
				headers: authHeaders(apiKey),
			});
			expect(deleteRes.status).toBe(200);
			const deleteBody = (await deleteRes.json()) as { removed: boolean };
			expect(deleteBody.removed).toBe(true);

			// Node should be offline now
			const nodeAfterDelete = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, nodeId))
			)[0];
			expect(nodeAfterDelete?.status).toBe("offline");

			// Stats should show 0 active, 1 total (offline nodes still count in total)
			const stats2 = (await (await app.request("/api/v1/stats")).json()) as {
				totalNodes: number;
				activeNodes: number;
			};
			expect(stats2.totalNodes).toBe(1);
			expect(stats2.activeNodes).toBe(0);
		});

		it("rejects heartbeat from a different node", async () => {
			const node1 = await registerNode(app, "node-1");
			const node2 = await registerNode(app, "node-2");

			// Node 2 tries to heartbeat as node 1
			const res = await app.request(`/api/v1/nodes/${node1.nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(node2.apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
				}),
			});
			expect(res.status).toBe(403);
		});

		it("idle heartbeat can auto-assign pending bounty", async () => {
			const node = await registerNode(app, "idle-claimer");

			// Create a bounty
			await submitBounty(app, { issueNumber: 50 });

			// Idle heartbeat should get bounty assigned
			const hbRes = await app.request(`/api/v1/nodes/${node.nodeId}/heartbeat`, {
				method: "POST",
				headers: authHeaders(node.apiKey),
				body: JSON.stringify({
					status: "idle",
					tokensUsedSinceLastHeartbeat: 0,
				}),
			});
			expect(hbRes.status).toBe(200);
			const hbBody = (await hbRes.json()) as {
				pendingBounty: Record<string, unknown> | null;
			};
			expect(hbBody.pendingBounty).not.toBeNull();
			expect(hbBody.pendingBounty?.issueTitle).toBe("Fix the bug");
		});
	});

	// ── 6. Solver can't review own submission ──

	describe("solver cannot review own submission", () => {
		it("returns 403 when solver tries to vote on their own fix", async () => {
			const solver = await registerNode(app, "self-reviewer");

			const { bountyId } = await submitBounty(app, { issueNumber: 30 });
			await claimBounty(app, solver.apiKey);

			const fixRes = await submitFix(app, bountyId, solver.apiKey);
			expect(fixRes.status).toBe(201);
			const { submissionId } = (await fixRes.json()) as { submissionId: string };

			// Solver tries to review their own submission
			const voteRes = await submitVote(app, submissionId, solver.apiKey, "approve");
			expect(voteRes.status).toBe(403);

			const body = (await voteRes.json()) as { error: string };
			expect(body.error).toBe("Cannot review your own submission");
		});
	});

	// ── Additional edge cases ───────────────────────────────────

	describe("edge cases", () => {
		it("probation node requires 3-of-3 consensus", async () => {
			// Solver stays on probation (no liftProbation call)
			const solver = await registerNode(app, "probation-solver");
			const reviewer1 = await registerNode(app, "r1");
			const reviewer2 = await registerNode(app, "r2");
			const reviewer3 = await registerNode(app, "r3");

			const { bountyId } = await submitBounty(app, { issueNumber: 40 });
			await claimBounty(app, solver.apiKey);

			const fixRes = await submitFix(app, bountyId, solver.apiKey);
			const { submissionId } = (await fixRes.json()) as { submissionId: string };

			// 2 approvals should NOT be enough for probation node
			const v1 = await submitVote(app, submissionId, reviewer1.apiKey, "approve");
			expect(((await v1.json()) as { consensusStatus: string }).consensusStatus).toBe("pending");

			const v2 = await submitVote(app, submissionId, reviewer2.apiKey, "approve");
			expect(((await v2.json()) as { consensusStatus: string }).consensusStatus).toBe("pending");

			// 3rd approval triggers consensus
			const v3 = await submitVote(app, submissionId, reviewer3.apiKey, "approve");
			expect(((await v3.json()) as { consensusStatus: string }).consensusStatus).toBe("approved");

			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("approved");
		});

		it("mixed votes: 1 approve + 2 reject = rejected", async () => {
			const solver = await registerNode(app, "solver");
			const r1 = await registerNode(app, "r1");
			const r2 = await registerNode(app, "r2");
			const r3 = await registerNode(app, "r3");
			await liftProbation(db, solver.nodeId);

			const { bountyId } = await submitBounty(app, { issueNumber: 41 });
			await claimBounty(app, solver.apiKey);

			const fixRes = await submitFix(app, bountyId, solver.apiKey);
			const { submissionId } = (await fixRes.json()) as { submissionId: string };

			// 1 approve, then 2 rejects
			await submitVote(app, submissionId, r1.apiKey, "approve");
			await submitVote(app, submissionId, r2.apiKey, "reject");
			const v3 = await submitVote(app, submissionId, r3.apiKey, "reject");
			expect(((await v3.json()) as { consensusStatus: string }).consensusStatus).toBe("rejected");

			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("rejected");

			// Reviewer who approved gets inaccurate penalty (-1.5)
			const r1Node = (
				await db.select().from(schema.nodes).where(eq(schema.nodes.id, r1.nodeId))
			)[0];
			expect(r1Node?.reputationScore).toBe(48.5); // 50 - 1.5
		});

		it("no bounty available returns null on claim", async () => {
			const { apiKey } = await registerNode(app, "empty-claimer");
			const result = await claimBounty(app, apiKey);
			expect(result.bounty).toBeNull();
		});

		it("submit fix to nonexistent bounty returns 404", async () => {
			const { apiKey } = await registerNode(app, "solver");
			const res = await submitFix(app, "bty_nonexistent", apiKey);
			expect(res.status).toBe(404);
		});

		it("vote on nonexistent submission returns 404", async () => {
			const { apiKey } = await registerNode(app, "reviewer");
			const res = await submitVote(app, "sub_nonexistent", apiKey, "approve");
			expect(res.status).toBe(404);
		});

		it("duplicate bounty submission returns 409", async () => {
			await submitBounty(app, { issueNumber: 99 });

			const res = await app.request("/api/v1/bounties", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					owner: "testorg",
					repo: "testrepo",
					issueNumber: 99,
					issueTitle: "Duplicate",
				}),
			});
			expect(res.status).toBe(409);
		});
	});
});
