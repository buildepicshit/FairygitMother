import type { GitHubIssue } from "@fairygitmother/core";
import { estimateComplexity, isEligible } from "@fairygitmother/server/orchestrator/trawler.js";
import { describe, expect, it } from "vitest";

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
	return {
		number: 1,
		title: "Fix typo in README",
		body: "There's a typo on line 42.",
		labels: [{ name: "good first issue" }],
		assignee: null,
		html_url: "https://github.com/test/repo/issues/1",
		...overrides,
	};
}

describe("trawler", () => {
	describe("isEligible", () => {
		it("returns true for issues with qualifying labels and no assignee", () => {
			expect(isEligible(makeIssue())).toBe(true);
			expect(isEligible(makeIssue({ labels: [{ name: "help wanted" }] }))).toBe(true);
			expect(isEligible(makeIssue({ labels: [{ name: "fairygitmother" }] }))).toBe(true);
		});

		it("returns true when qualifying label has different casing", () => {
			expect(isEligible(makeIssue({ labels: [{ name: "Good First Issue" }] }))).toBe(true);
			expect(isEligible(makeIssue({ labels: [{ name: "HELP WANTED" }] }))).toBe(true);
		});

		it("returns false for assigned issues", () => {
			const issue = makeIssue({ assignee: { login: "someone" } });
			expect(isEligible(issue)).toBe(false);
		});

		it("returns false for pull requests", () => {
			const issue = makeIssue({ pull_request: { url: "https://api.github.com/..." } });
			expect(isEligible(issue)).toBe(false);
		});

		it("returns false for issues without qualifying labels", () => {
			const issue = makeIssue({ labels: [{ name: "bug" }, { name: "enhancement" }] });
			expect(isEligible(issue)).toBe(false);
		});

		it("returns false for issues with no labels", () => {
			const issue = makeIssue({ labels: [] });
			expect(isEligible(issue)).toBe(false);
		});
	});

	describe("estimateComplexity", () => {
		it("returns 1 for typo issues", () => {
			const issue = makeIssue({ labels: [{ name: "good first issue" }, { name: "typo" }] });
			expect(estimateComplexity(issue)).toBe(1);
		});

		it("returns 1 for documentation issues", () => {
			const issue = makeIssue({
				labels: [{ name: "good first issue" }, { name: "documentation" }],
			});
			expect(estimateComplexity(issue)).toBe(1);
		});

		it("returns 4 for breaking-change issues", () => {
			const issue = makeIssue({
				labels: [{ name: "good first issue" }, { name: "breaking-change" }],
			});
			expect(estimateComplexity(issue)).toBe(4);
		});

		it("returns 4 for refactor issues", () => {
			const issue = makeIssue({
				labels: [{ name: "good first issue" }, { name: "refactor" }],
			});
			expect(estimateComplexity(issue)).toBe(4);
		});

		it("returns 1 for issues with short body (< 100 chars)", () => {
			const issue = makeIssue({
				body: "Short body.",
				labels: [{ name: "good first issue" }],
			});
			expect(estimateComplexity(issue)).toBe(1);
		});

		it("returns 2 for issues with medium body (100-500 chars)", () => {
			const issue = makeIssue({
				body: "A".repeat(200),
				labels: [{ name: "good first issue" }],
			});
			expect(estimateComplexity(issue)).toBe(2);
		});

		it("returns 3 for issues with long body (500-2000 chars)", () => {
			const issue = makeIssue({
				body: "A".repeat(1000),
				labels: [{ name: "good first issue" }],
			});
			expect(estimateComplexity(issue)).toBe(3);
		});

		it("returns 4 for issues with very long body (> 2000 chars)", () => {
			const issue = makeIssue({
				body: "A".repeat(3000),
				labels: [{ name: "good first issue" }],
			});
			expect(estimateComplexity(issue)).toBe(4);
		});

		it("returns 1 for issues with null body", () => {
			const issue = makeIssue({ body: null, labels: [{ name: "good first issue" }] });
			expect(estimateComplexity(issue)).toBe(1);
		});
	});
});
