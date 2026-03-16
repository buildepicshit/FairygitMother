import { describe, it, expect } from "vitest";
import {
	generateUnifiedDiff,
	type FileChange,
	type RepoFile,
	type RepoTree,
} from "@fairygitmother/node";
import { buildApiSolvePrompt, buildApiReviewPrompt } from "@fairygitmother/node";

describe("generateUnifiedDiff", () => {
	it("generates diff for a single file change", () => {
		const changes: FileChange[] = [
			{
				path: "src/utils.ts",
				originalContent: "export function add(a: number, b: number) {\n  return a + b;\n}\n",
				newContent:
					"export function add(a: number, b: number): number {\n  return a + b;\n}\n",
			},
		];

		const diff = generateUnifiedDiff(changes);
		expect(diff).toContain("--- a/src/utils.ts");
		expect(diff).toContain("+++ b/src/utils.ts");
		expect(diff).toContain("-export function add(a: number, b: number) {");
		expect(diff).toContain("+export function add(a: number, b: number): number {");
	});

	it("generates diff for multiple file changes", () => {
		const changes: FileChange[] = [
			{
				path: "a.ts",
				originalContent: "const x = 1;\n",
				newContent: "const x = 2;\n",
			},
			{
				path: "b.ts",
				originalContent: "const y = true;\n",
				newContent: "const y = false;\n",
			},
		];

		const diff = generateUnifiedDiff(changes);
		expect(diff).toContain("--- a/a.ts");
		expect(diff).toContain("--- a/b.ts");
	});

	it("handles added lines", () => {
		const changes: FileChange[] = [
			{
				path: "file.ts",
				originalContent: "line1\nline2\n",
				newContent: "line1\nnewline\nline2\n",
			},
		];

		const diff = generateUnifiedDiff(changes);
		expect(diff).toContain("+newline");
	});

	it("handles removed lines", () => {
		const changes: FileChange[] = [
			{
				path: "file.ts",
				originalContent: "line1\nremoveme\nline2\n",
				newContent: "line1\nline2\n",
			},
		];

		const diff = generateUnifiedDiff(changes);
		expect(diff).toContain("-removeme");
	});

	it("returns empty for no changes", () => {
		const changes: FileChange[] = [
			{
				path: "file.ts",
				originalContent: "same\n",
				newContent: "same\n",
			},
		];

		const diff = generateUnifiedDiff(changes);
		// No +/- lines means no hunk header
		expect(diff).not.toContain("@@");
	});
});

describe("buildApiSolvePrompt", () => {
	const mockBounty = {
		id: "bty_test",
		repoUrl: "https://github.com/org/repo",
		owner: "org",
		repo: "repo",
		issueNumber: 42,
		issueTitle: "Bug in parser",
		issueBody: "The parser crashes on null input",
		labels: ["good first issue"],
		language: "TypeScript",
		complexityEstimate: 2,
		status: "assigned" as const,
		assignedNodeId: "node_test",
		priority: 50,
		retryCount: 0,
		createdAt: "2026-03-15T00:00:00Z",
	};

	const mockFiles: RepoFile[] = [
		{ path: "src/parser.ts", content: "export function parse(x) { return x.trim(); }", size: 46, sha: "abc" },
	];

	const mockTree: RepoTree = {
		files: [
			{ path: "src/parser.ts", size: 46, sha: "abc", type: "blob" },
			{ path: "package.json", size: 200, sha: "def", type: "blob" },
		],
		truncated: false,
	};

	it("includes issue details", () => {
		const prompt = buildApiSolvePrompt(mockBounty, mockFiles, mockTree);
		expect(prompt).toContain("#42");
		expect(prompt).toContain("Bug in parser");
		expect(prompt).toContain("crashes on null input");
	});

	it("includes file contents", () => {
		const prompt = buildApiSolvePrompt(mockBounty, mockFiles, mockTree);
		expect(prompt).toContain("src/parser.ts");
		expect(prompt).toContain("parse(x)");
	});

	it("includes repo tree", () => {
		const prompt = buildApiSolvePrompt(mockBounty, mockFiles, mockTree);
		expect(prompt).toContain("package.json");
	});

	it("requests JSON response format", () => {
		const prompt = buildApiSolvePrompt(mockBounty, mockFiles, mockTree);
		expect(prompt).toContain('"explanation"');
		expect(prompt).toContain('"changes"');
	});
});

describe("buildApiReviewPrompt", () => {
	const mockBounty = {
		id: "bty_test",
		repoUrl: "https://github.com/org/repo",
		owner: "org",
		repo: "repo",
		issueNumber: 42,
		issueTitle: "Bug",
		issueBody: "Fix it",
		labels: [],
		language: "TypeScript",
		complexityEstimate: 2,
		status: "assigned" as const,
		assignedNodeId: "node_test",
		priority: 50,
		retryCount: 0,
		createdAt: "2026-03-15T00:00:00Z",
	};

	const mockFiles: RepoFile[] = [
		{ path: "src/file.ts", content: "original code", size: 13, sha: "abc" },
	];

	it("includes original source files for context", () => {
		const prompt = buildApiReviewPrompt(mockBounty, "+fix", "Fixed it", mockFiles);
		expect(prompt).toContain("original code");
		expect(prompt).toContain("src/file.ts");
	});

	it("includes diff and explanation", () => {
		const prompt = buildApiReviewPrompt(mockBounty, "+fix line", "Added fix", mockFiles);
		expect(prompt).toContain("+fix line");
		expect(prompt).toContain("Added fix");
	});
});
