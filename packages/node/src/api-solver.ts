/**
 * API-only solver — reads repo files via GitHub API, never clones.
 *
 * Zero attack surface: no git hooks, no submodules, no code on disk,
 * no Docker needed. The agent reads files through the GitHub Contents/Trees
 * API and produces a diff purely from that data.
 *
 * Trade-offs vs container mode:
 * - Can't run tests (no local copy)
 * - GitHub API rate limits (5,000/hour authenticated)
 * - Files over 1MB need Blobs API
 * - Best for simple fixes (good first issue, typos, small bugs)
 */

import type { Bounty, GitHubClient } from "@fairygitmother/core";

// ── Types ──────────────────────────────────────────────────────

export interface ApiSolverContext {
	github: GitHubClient;
	bounty: Bounty;
}

export interface RepoFile {
	path: string;
	content: string;
	size: number;
	sha: string;
}

export interface RepoTree {
	files: Array<{
		path: string;
		size: number;
		sha: string;
		type: "blob" | "tree";
	}>;
	truncated: boolean;
}

export interface ApiSolverResult {
	files: RepoFile[];
	tree: RepoTree;
}

// ── File reading via GitHub API ────────────────────────────────

export async function fetchRepoTree(
	github: GitHubClient,
	owner: string,
	repo: string,
	ref = "HEAD",
): Promise<RepoTree> {
	const { tree, truncated } = await github.getTreeRecursive(owner, repo, ref);

	return {
		files: tree
			.filter((entry) => entry.type === "blob")
			.map((entry) => ({
				path: entry.path,
				size: entry.size ?? 0,
				sha: entry.sha,
				type: entry.type as "blob" | "tree",
			})),
		truncated,
	};
}

export async function fetchFile(
	github: GitHubClient,
	owner: string,
	repo: string,
	path: string,
): Promise<RepoFile> {
	const data = await github.getContentRaw(owner, repo, path);

	if (data.type !== "file") {
		throw new Error(`${path} is not a file`);
	}

	const content =
		data.encoding === "base64" && data.content
			? Buffer.from(data.content, "base64").toString("utf-8")
			: (data.content ?? "");

	return {
		path,
		content,
		size: data.size,
		sha: data.sha,
	};
}

export async function fetchFiles(
	github: GitHubClient,
	owner: string,
	repo: string,
	paths: string[],
): Promise<RepoFile[]> {
	const results: RepoFile[] = [];
	for (const path of paths) {
		try {
			const file = await fetchFile(github, owner, repo, path);
			results.push(file);
		} catch {
			// Skip files that can't be read (too large, binary, etc.)
		}
	}
	return results;
}

// ── Context builder ────────────────────────────────────────────

/**
 * Builds a solve context from GitHub API data.
 * Returns the repo tree and key files the agent will need.
 */
export async function buildApiSolverContext(
	github: GitHubClient,
	bounty: Bounty,
): Promise<ApiSolverResult> {
	const { owner, repo } = bounty;

	// Get full file tree
	const tree = await fetchRepoTree(github, owner, repo);

	// Identify likely relevant files based on issue content
	const relevantPaths = identifyRelevantFiles(tree, bounty);

	// Fetch the relevant files (limit to avoid rate exhaustion)
	const files = await fetchFiles(github, owner, repo, relevantPaths.slice(0, 20));

	return { files, tree };
}

/**
 * Identifies files likely relevant to the issue based on:
 * - File names mentioned in the issue body
 * - Common entry points (README, package.json, etc.)
 * - Files matching the issue's language
 */
function identifyRelevantFiles(tree: RepoTree, bounty: Bounty): string[] {
	const issueText = `${bounty.issueTitle} ${bounty.issueBody}`.toLowerCase();
	const allPaths = tree.files.map((f) => f.path);
	const relevant = new Set<string>();

	// Files explicitly mentioned in the issue
	for (const file of allPaths) {
		const fileName = file.split("/").pop()?.toLowerCase() ?? "";
		if (issueText.includes(fileName) && fileName.length > 3) {
			relevant.add(file);
		}
		// Also match partial paths mentioned
		if (issueText.includes(file.toLowerCase())) {
			relevant.add(file);
		}
	}

	// Config/entry point files (always useful for context)
	const configFiles = [
		"package.json",
		"tsconfig.json",
		"pyproject.toml",
		"setup.py",
		"Cargo.toml",
		"go.mod",
		"pom.xml",
		"build.gradle",
	];
	for (const cfg of configFiles) {
		if (allPaths.includes(cfg)) {
			relevant.add(cfg);
		}
	}

	// Source files in common directories, filtered by language
	const langExtensions = getLanguageExtensions(bounty.language);
	const srcDirs = ["src/", "lib/", "app/", "pkg/", "internal/"];
	for (const file of allPaths) {
		const inSrcDir = srcDirs.some((dir) => file.startsWith(dir));
		const matchesLang = langExtensions.some((ext) => file.endsWith(ext));
		if (inSrcDir && matchesLang && !file.includes("test") && !file.includes("spec")) {
			relevant.add(file);
		}
	}

	return Array.from(relevant);
}

function getLanguageExtensions(language: string | null): string[] {
	const map: Record<string, string[]> = {
		typescript: [".ts", ".tsx"],
		javascript: [".js", ".jsx", ".mjs"],
		python: [".py"],
		rust: [".rs"],
		go: [".go"],
		java: [".java"],
		"c#": [".cs"],
		ruby: [".rb"],
		php: [".php"],
		swift: [".swift"],
		kotlin: [".kt"],
		c: [".c", ".h"],
		"c++": [".cpp", ".hpp", ".cc", ".hh"],
	};
	return map[(language ?? "").toLowerCase()] ?? [".ts", ".js", ".py", ".go", ".rs"];
}

// ── Diff generation helpers ────────────────────────────────────

export interface FileChange {
	path: string;
	originalContent: string;
	newContent: string;
}

/**
 * Generates a unified diff from file changes.
 * This is what the agent produces — old content vs new content.
 */
export function generateUnifiedDiff(changes: FileChange[]): string {
	const parts: string[] = [];

	for (const change of changes) {
		const oldLines = change.originalContent.split("\n");
		const newLines = change.newContent.split("\n");

		parts.push(`--- a/${change.path}`);
		parts.push(`+++ b/${change.path}`);

		// Simple diff: show removed and added lines
		// A real implementation would use a proper diff algorithm,
		// but agents typically produce the full new file content
		const hunks = computeHunks(oldLines, newLines);
		for (const hunk of hunks) {
			parts.push(hunk);
		}
	}

	return parts.join("\n");
}

function computeHunks(oldLines: string[], newLines: string[]): string[] {
	// LCS-based diff split into context-aware hunks
	const lcs = longestCommonSubsequence(oldLines, newLines);
	const CONTEXT = 3;

	// Build a flat list of diff operations
	type DiffLine = {
		type: "context" | "add" | "remove";
		text: string;
		oldLine: number;
		newLine: number;
	};
	const allDiffLines: DiffLine[] = [];
	let oldIdx = 0;
	let newIdx = 0;

	for (const common of lcs) {
		while (oldIdx < oldLines.length && oldLines[oldIdx] !== common) {
			allDiffLines.push({
				type: "remove",
				text: oldLines[oldIdx],
				oldLine: oldIdx + 1,
				newLine: newIdx + 1,
			});
			oldIdx++;
		}
		while (newIdx < newLines.length && newLines[newIdx] !== common) {
			allDiffLines.push({
				type: "add",
				text: newLines[newIdx],
				oldLine: oldIdx + 1,
				newLine: newIdx + 1,
			});
			newIdx++;
		}
		allDiffLines.push({ type: "context", text: common, oldLine: oldIdx + 1, newLine: newIdx + 1 });
		oldIdx++;
		newIdx++;
	}
	while (oldIdx < oldLines.length) {
		allDiffLines.push({
			type: "remove",
			text: oldLines[oldIdx],
			oldLine: oldIdx + 1,
			newLine: newIdx + 1,
		});
		oldIdx++;
	}
	while (newIdx < newLines.length) {
		allDiffLines.push({
			type: "add",
			text: newLines[newIdx],
			oldLine: oldIdx + 1,
			newLine: newIdx + 1,
		});
		newIdx++;
	}

	// Find change regions and group into hunks with context
	const changeIndices = allDiffLines
		.map((l, i) => (l.type !== "context" ? i : -1))
		.filter((i) => i >= 0);
	if (changeIndices.length === 0) return [];

	const result: string[] = [];
	let hunkStart = Math.max(0, changeIndices[0] - CONTEXT);

	for (let ci = 0; ci < changeIndices.length; ci++) {
		const nextChangeIdx = ci + 1 < changeIndices.length ? changeIndices[ci + 1] : null;
		const currentEnd = changeIndices[ci] + CONTEXT;

		// If next change is within context range, extend this hunk
		if (nextChangeIdx !== null && nextChangeIdx <= currentEnd + 1) {
			continue;
		}

		// Emit this hunk
		const hunkEnd = Math.min(allDiffLines.length - 1, currentEnd);
		const hunkLines: string[] = [];
		let oldStart = 0;
		let newStart = 0;
		let oldCount = 0;
		let newCount = 0;

		for (let i = hunkStart; i <= hunkEnd; i++) {
			const dl = allDiffLines[i];
			if (i === hunkStart) {
				oldStart = dl.oldLine;
				newStart = dl.newLine;
			}
			if (dl.type === "context") {
				hunkLines.push(` ${dl.text}`);
				oldCount++;
				newCount++;
			} else if (dl.type === "remove") {
				hunkLines.push(`-${dl.text}`);
				oldCount++;
			} else {
				hunkLines.push(`+${dl.text}`);
				newCount++;
			}
		}

		result.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
		result.push(...hunkLines);

		// Next hunk starts after this one's context
		if (nextChangeIdx !== null) {
			hunkStart = Math.max(hunkEnd + 1, nextChangeIdx - CONTEXT);
		}
	}

	return result;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find the actual subsequence
	const result: string[] = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			result.unshift(a[i - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return result;
}
