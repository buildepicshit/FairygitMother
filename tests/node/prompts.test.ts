import { describe, it, expect } from "vitest";
import { buildSolvePrompt, buildReviewPrompt } from "@fairygitmother/node";

const mockBounty = {
	id: "bty_test",
	repoUrl: "https://github.com/org/repo",
	owner: "org",
	repo: "repo",
	issueNumber: 42,
	issueTitle: "TypeError in parse function",
	issueBody: "The parse function throws when input is null.",
	labels: ["good first issue"],
	language: "TypeScript",
	complexityEstimate: 2,
	status: "assigned" as const,
	assignedNodeId: "node_test",
	priority: 50,
	retryCount: 0,
	createdAt: "2026-03-15T00:00:00Z",
};

describe("buildSolvePrompt", () => {
	it("includes issue details", () => {
		const prompt = buildSolvePrompt(mockBounty);
		expect(prompt).toContain("#42");
		expect(prompt).toContain("TypeError in parse function");
		expect(prompt).toContain("throws when input is null");
	});

	it("includes safety rules", () => {
		const prompt = buildSolvePrompt(mockBounty);
		expect(prompt).toContain("NEVER run");
		expect(prompt).toContain("npm install");
		expect(prompt).toContain("NEVER execute any script");
	});

	it("instructs minimal fix", () => {
		const prompt = buildSolvePrompt(mockBounty);
		expect(prompt).toContain("minimal, focused fix");
		expect(prompt).toContain("Change only what is necessary");
	});
});

describe("buildReviewPrompt", () => {
	it("includes issue and diff", () => {
		const prompt = buildReviewPrompt(mockBounty, "+if (x === null) return;", "Added null check");
		expect(prompt).toContain("#42");
		expect(prompt).toContain("+if (x === null) return;");
		expect(prompt).toContain("Added null check");
	});

	it("includes review criteria", () => {
		const prompt = buildReviewPrompt(mockBounty, "+fix", "fix");
		expect(prompt).toContain("Correctness");
		expect(prompt).toContain("Minimality");
		expect(prompt).toContain("Security");
	});

	it("requests structured response", () => {
		const prompt = buildReviewPrompt(mockBounty, "+fix", "fix");
		expect(prompt).toContain('"decision"');
		expect(prompt).toContain('"approve"');
		expect(prompt).toContain('"reject"');
	});
});
