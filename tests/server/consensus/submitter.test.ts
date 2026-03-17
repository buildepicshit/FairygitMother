import { generateApiKey, generateId } from "@fairygitmother/core";
import type { GitHubClient } from "@fairygitmother/core";
import { buildPrBody, submitPr } from "@fairygitmother/server/consensus/submitter.js";
import * as schema from "@fairygitmother/server/db/schema.js";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type TestDb, cleanAllTables, createTestDb } from "../../helpers/db.js";

function createMockGitHub(): GitHubClient & { calls: Record<string, unknown[][]> } {
	const calls: Record<string, unknown[][]> = {};

	function track(name: string) {
		calls[name] = calls[name] ?? [];
		return (...args: unknown[]) => {
			calls[name].push(args);
		};
	}

	return {
		calls,
		createFork: vi.fn(async (owner: string, repo: string) => {
			track("createFork")(owner, repo);
			return { full_name: `forkbot/${repo}`, clone_url: `https://github.com/forkbot/${repo}.git` };
		}),
		getRef: vi.fn(async () => {
			track("getRef")();
			return "abc123sha";
		}),
		getCommit: vi.fn(async () => {
			track("getCommit")();
			return { treeSha: "tree123sha" };
		}),
		getFileContent: vi.fn(async (_o: string, _r: string, path: string) => {
			track("getFileContent")(path);
			return `original content of ${path}\n`;
		}),
		createBlob: vi.fn(async () => "blob123"),
		createTree: vi.fn(async () => {
			track("createTree")();
			return "newtree123sha";
		}),
		createCommitOnRepo: vi.fn(async () => {
			track("createCommitOnRepo")();
			return "newcommit123sha";
		}),
		createRefOnRepo: vi.fn(async () => {
			track("createRefOnRepo")();
		}),
		createPullRequest: vi.fn(async () => {
			track("createPullRequest")();
			return { number: 42, html_url: "https://github.com/testorg/testrepo/pull/42" };
		}),
	} as unknown as GitHubClient & { calls: Record<string, unknown[][]> };
}

async function setupSubmissionScenario(db: TestDb) {
	const solverId = generateId("node");
	await db.insert(schema.nodes).values({
		id: solverId,
		apiKey: generateApiKey(),
		capabilities: { languages: [], tools: [] },
		solverBackend: "test",
		totalBountiesSolved: 10,
		reputationScore: 50,
	});

	const bountyId = generateId("bty");
	await db.insert(schema.bounties).values({
		id: bountyId,
		owner: "testorg",
		repo: "testrepo",
		issueNumber: 99,
		issueTitle: "Fix the parser bug",
		issueBody: "The parser crashes on empty input",
		labels: ["bug"],
		status: "in_review",
		assignedNodeId: solverId,
	});

	const submissionId = generateId("sub");
	const diff = [
		"--- a/src/parser.ts",
		"+++ b/src/parser.ts",
		"@@ -1,3 +1,3 @@",
		" function parse(input) {",
		"-  return input.split(',');",
		"+  return input ? input.split(',') : [];",
		" }",
	].join("\n");

	await db.insert(schema.submissions).values({
		id: submissionId,
		bountyId,
		nodeId: solverId,
		diff,
		explanation: "Added null check for empty input",
		filesChanged: ["src/parser.ts"],
		solverBackend: "test",
		solveDurationMs: 5000,
	});

	return { solverId, bountyId, submissionId, diff };
}

async function addConsensusApproval(db: TestDb, submissionId: string) {
	const reviewerIds: string[] = [];
	for (let i = 0; i < 2; i++) {
		const reviewerId = generateId("node");
		await db.insert(schema.nodes).values({
			id: reviewerId,
			apiKey: generateApiKey(),
			capabilities: { languages: [], tools: [] },
			solverBackend: "test",
			totalBountiesSolved: 10,
			reputationScore: 50,
		});
		await db.insert(schema.votes).values({
			id: generateId("vote"),
			submissionId,
			reviewerNodeId: reviewerId,
			decision: "approve",
			reasoning: "LGTM",
			confidence: 0.9,
		});
		reviewerIds.push(reviewerId);
	}

	const consensusId = generateId("cons");
	await db.insert(schema.consensusResults).values({
		id: consensusId,
		submissionId,
		outcome: "approved",
		approveCount: 2,
		rejectCount: 0,
		totalVotes: 2,
	});

	return { reviewerIds, consensusId };
}

describe("PR submitter", () => {
	describe("buildPrBody", () => {
		it("generates correct PR body", () => {
			const body = buildPrBody(
				"testorg",
				"testrepo",
				42,
				"Fixed the null check in the parser",
				"node_abc123",
				"openclaw",
				2,
				3,
			);

			expect(body).toContain("Fixes #42");
			expect(body).toContain("Fixed the null check in the parser");
			expect(body).toContain("`node_abc123` (openclaw)");
			expect(body).toContain("3 independent agents");
			expect(body).toContain("2/3 approved");
			expect(body).toContain("FairygitMother");
			expect(body).toContain("fairygitmother: false");
		});

		it("handles 3-of-3 consensus", () => {
			const body = buildPrBody("org", "repo", 1, "fix", "node_1", "test", 3, 3);
			expect(body).toContain("3/3 approved");
		});
	});

	describe("submitPr", () => {
		let db: TestDb;

		beforeEach(async () => {
			db = createTestDb();
			await cleanAllTables(db);
		});

		it("creates fork, branch, commit, and PR through GitHub API", async () => {
			const { submissionId } = await setupSubmissionScenario(db);
			await addConsensusApproval(db, submissionId);

			const github = createMockGitHub();
			const result = await submitPr(db, github, submissionId, "forkbot");

			expect(result).not.toBeNull();
			expect(result?.prNumber).toBe(42);
			expect(result?.prUrl).toBe("https://github.com/testorg/testrepo/pull/42");

			// Verify all 7 GitHub API calls were made
			expect(github.createFork).toHaveBeenCalledWith("testorg", "testrepo");
			expect(github.getRef).toHaveBeenCalledWith("testorg", "testrepo", "heads/main");
			expect(github.getCommit).toHaveBeenCalledWith("testorg", "testrepo", "abc123sha");
			expect(github.getFileContent).toHaveBeenCalled();
			expect(github.createTree).toHaveBeenCalled();
			expect(github.createCommitOnRepo).toHaveBeenCalled();
			expect(github.createRefOnRepo).toHaveBeenCalled();
			expect(github.createPullRequest).toHaveBeenCalled();
		});

		it("updates bounty status to pr_submitted", async () => {
			const { submissionId, bountyId } = await setupSubmissionScenario(db);
			await addConsensusApproval(db, submissionId);

			const github = createMockGitHub();
			await submitPr(db, github, submissionId, "forkbot");

			const bounty = (
				await db.select().from(schema.bounties).where(eq(schema.bounties.id, bountyId))
			)[0];
			expect(bounty?.status).toBe("pr_submitted");
		});

		it("stores PR URL in consensus result", async () => {
			const { submissionId } = await setupSubmissionScenario(db);
			const { consensusId } = await addConsensusApproval(db, submissionId);

			const github = createMockGitHub();
			await submitPr(db, github, submissionId, "forkbot");

			const consensus = (
				await db
					.select()
					.from(schema.consensusResults)
					.where(eq(schema.consensusResults.id, consensusId))
			)[0];
			expect(consensus?.prUrl).toBe("https://github.com/testorg/testrepo/pull/42");
		});

		it("returns null if no consensus exists", async () => {
			const { submissionId } = await setupSubmissionScenario(db);
			// No consensus added

			const github = createMockGitHub();
			const result = await submitPr(db, github, submissionId, "forkbot");
			expect(result).toBeNull();
			expect(github.createFork).not.toHaveBeenCalled();
		});

		it("returns null if consensus is not approved", async () => {
			const { submissionId } = await setupSubmissionScenario(db);

			// Add rejected consensus
			await db.insert(schema.consensusResults).values({
				id: generateId("cons"),
				submissionId,
				outcome: "rejected",
				approveCount: 0,
				rejectCount: 2,
				totalVotes: 2,
			});

			const github = createMockGitHub();
			const result = await submitPr(db, github, submissionId, "forkbot");
			expect(result).toBeNull();
		});

		it("returns null if diff is empty", async () => {
			const solverId = generateId("node");
			await db.insert(schema.nodes).values({
				id: solverId,
				apiKey: generateApiKey(),
				capabilities: { languages: [], tools: [] },
				solverBackend: "test",
				totalBountiesSolved: 10,
			});

			const bountyId = generateId("bty");
			await db.insert(schema.bounties).values({
				id: bountyId,
				owner: "org",
				repo: "repo",
				issueNumber: 1,
				issueTitle: "Bug",
				issueBody: "",
				labels: [],
				status: "in_review",
			});

			const submissionId = generateId("sub");
			await db.insert(schema.submissions).values({
				id: submissionId,
				bountyId,
				nodeId: solverId,
				diff: "", // Empty diff
				explanation: "no changes",
				filesChanged: [],
				solverBackend: "test",
				solveDurationMs: 1000,
			});

			await db.insert(schema.consensusResults).values({
				id: generateId("cons"),
				submissionId,
				outcome: "approved",
				approveCount: 2,
				rejectCount: 0,
				totalVotes: 2,
			});

			const github = createMockGitHub();
			const result = await submitPr(db, github, submissionId, "forkbot");
			expect(result).toBeNull();
		});

		it("creates branch with correct naming convention", async () => {
			const { submissionId } = await setupSubmissionScenario(db);
			await addConsensusApproval(db, submissionId);

			const github = createMockGitHub();
			await submitPr(db, github, submissionId, "forkbot");

			// Branch name: fairygitmother/fix-{issueNumber}-{submissionId prefix}
			const createRefCall = (github.createRefOnRepo as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(createRefCall[0]).toBe("forkbot"); // fork owner
			expect(createRefCall[1]).toBe("testrepo"); // repo
			expect(createRefCall[2]).toMatch(/^refs\/heads\/fairygitmother\/fix-99-/);
		});

		it("creates PR with transparency disclosure", async () => {
			const { submissionId } = await setupSubmissionScenario(db);
			await addConsensusApproval(db, submissionId);

			const github = createMockGitHub();
			await submitPr(db, github, submissionId, "forkbot");

			const prCall = (github.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0];
			const prBody = prCall[5] as string;
			expect(prBody).toContain("Fixes #99");
			expect(prBody).toContain("FairygitMother");
			expect(prBody).toContain("2/2 approved");
			expect(prBody).toContain("fairygitmother: false"); // opt-out instruction
		});
	});
});
