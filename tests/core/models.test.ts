import { describe, it, expect } from "vitest";
import {
	BountySchema,
	BountyStatusSchema,
	FixSubmissionSchema,
	ReviewVoteSchema,
	NodeRegistrationSchema,
	ConsensusResultSchema,
	RepoConfigSchema,
	AuditLogEntrySchema,
} from "@fairygitmother/core";

describe("BountyStatusSchema", () => {
	it("accepts valid statuses", () => {
		const statuses = [
			"queued",
			"assigned",
			"in_progress",
			"diff_submitted",
			"in_review",
			"approved",
			"rejected",
			"pr_submitted",
		];
		for (const s of statuses) {
			expect(BountyStatusSchema.parse(s)).toBe(s);
		}
	});

	it("rejects invalid status", () => {
		expect(() => BountyStatusSchema.parse("invalid")).toThrow();
	});
});

describe("BountySchema", () => {
	const validBounty = {
		id: "bty_abc123",
		repoUrl: "https://github.com/owner/repo",
		owner: "owner",
		repo: "repo",
		issueNumber: 42,
		issueTitle: "Fix the bug",
		issueBody: "This is broken",
		labels: ["good first issue"],
		language: "TypeScript",
		complexityEstimate: 2,
		status: "queued",
		assignedNodeId: null,
		priority: 50,
		retryCount: 0,
		createdAt: "2026-03-15T00:00:00Z",
	};

	it("parses a valid bounty", () => {
		const result = BountySchema.parse(validBounty);
		expect(result.id).toBe("bty_abc123");
		expect(result.issueNumber).toBe(42);
		expect(result.status).toBe("queued");
	});

	it("rejects invalid issue number", () => {
		expect(() => BountySchema.parse({ ...validBounty, issueNumber: -1 })).toThrow();
	});

	it("rejects complexity outside 1-5", () => {
		expect(() => BountySchema.parse({ ...validBounty, complexityEstimate: 0 })).toThrow();
		expect(() => BountySchema.parse({ ...validBounty, complexityEstimate: 6 })).toThrow();
	});

	it("accepts null language", () => {
		const result = BountySchema.parse({ ...validBounty, language: null });
		expect(result.language).toBeNull();
	});
});

describe("FixSubmissionSchema", () => {
	it("parses a valid submission", () => {
		const result = FixSubmissionSchema.parse({
			id: "sub_abc",
			bountyId: "bty_abc",
			nodeId: "node_abc",
			diff: "--- a/file.ts\n+++ b/file.ts\n",
			explanation: "Fixed the bug",
			filesChanged: ["file.ts"],
			testsPassed: null,
			tokensUsed: 1500,
			solverBackend: "openclaw",
			solveDurationMs: 30000,
			submittedAt: "2026-03-15T00:00:00Z",
		});
		expect(result.filesChanged).toEqual(["file.ts"]);
	});
});

describe("ReviewVoteSchema", () => {
	it("validates confidence range", () => {
		expect(() =>
			ReviewVoteSchema.parse({
				id: "vote_abc",
				submissionId: "sub_abc",
				reviewerNodeId: "node_abc",
				decision: "approve",
				reasoning: "Looks good",
				issuesFound: [],
				confidence: 1.5,
				testsRun: false,
				votedAt: "2026-03-15T00:00:00Z",
			}),
		).toThrow();
	});

	it("accepts valid vote", () => {
		const result = ReviewVoteSchema.parse({
			id: "vote_abc",
			submissionId: "sub_abc",
			reviewerNodeId: "node_abc",
			decision: "reject",
			reasoning: "Missing edge case",
			issuesFound: ["No null check"],
			confidence: 0.8,
			testsRun: true,
			votedAt: "2026-03-15T00:00:00Z",
		});
		expect(result.decision).toBe("reject");
	});
});

describe("RepoConfigSchema", () => {
	it("applies defaults", () => {
		const result = RepoConfigSchema.parse({});
		expect(result.enabled).toBe(true);
		expect(result.labels).toEqual(["good first issue", "help wanted"]);
		expect(result.maxPrsPerDay).toBe(2);
	});

	it("accepts custom values", () => {
		const result = RepoConfigSchema.parse({
			enabled: false,
			labels: ["fairygitmother"],
			maxPrsPerDay: 5,
		});
		expect(result.enabled).toBe(false);
		expect(result.labels).toEqual(["fairygitmother"]);
	});
});

describe("ConsensusResultSchema", () => {
	it("parses approved result", () => {
		const result = ConsensusResultSchema.parse({
			id: "cons_abc",
			submissionId: "sub_abc",
			outcome: "approved",
			approveCount: 2,
			rejectCount: 1,
			totalVotes: 3,
			decidedAt: "2026-03-15T00:00:00Z",
		});
		expect(result.outcome).toBe("approved");
	});
});
