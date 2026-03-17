/**
 * Bounty enrichment — pre-fetches file context from GitHub so agents
 * receive actual code in the bounty payload instead of fetching it themselves.
 *
 * Runs asynchronously after bounty creation. If enrichment fails (rate limit,
 * network error), the bounty is still claimable — agents just need to fetch
 * files themselves as before.
 */

import { eq } from "drizzle-orm";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties } from "../db/schema.js";

interface FileEntry {
	path: string;
	content: string;
}

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 15;
const MAX_FILE_SIZE = 100_000; // 100KB per file

/**
 * Fetch relevant file content from GitHub and store on the bounty.
 */
export async function enrichBountyContext(
	db: FairygitMotherDb,
	bountyId: string,
	owner: string,
	repo: string,
	issueTitle: string,
	issueBody: string,
	language: string | null,
	githubToken?: string,
): Promise<void> {
	try {
		const headers: Record<string, string> = {
			Accept: "application/vnd.github+json",
			"User-Agent": "FairygitMother",
		};
		if (githubToken) {
			headers.Authorization = `Bearer ${githubToken}`;
		}

		// 1. Fetch repo tree
		const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, {
			headers,
			signal: AbortSignal.timeout(10_000),
		});
		if (!treeRes.ok) return;

		const treeData = (await treeRes.json()) as {
			tree: Array<{ path: string; size?: number; type: string }>;
		};
		const allPaths = treeData.tree
			.filter((e) => e.type === "blob")
			.map((e) => ({ path: e.path, size: e.size ?? 0 }));

		// 2. Identify relevant files
		const relevant = identifyRelevantFiles(allPaths, issueTitle, issueBody, language);

		// 3. Fetch file contents
		const files: FileEntry[] = [];
		for (const filePath of relevant.slice(0, MAX_FILES)) {
			try {
				const fileRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`, {
					headers,
					signal: AbortSignal.timeout(5_000),
				});
				if (!fileRes.ok) continue;

				const fileData = (await fileRes.json()) as {
					content?: string;
					encoding?: string;
					size: number;
				};

				if (fileData.size > MAX_FILE_SIZE) continue;
				if (fileData.encoding !== "base64" || !fileData.content) continue;

				const content = Buffer.from(fileData.content, "base64").toString("utf-8");
				files.push({ path: filePath, content });
			} catch {
				// Skip files that fail to fetch
			}
		}

		if (files.length === 0) return;

		// 4. Store on bounty
		await db.update(bounties).set({ fileContext: files }).where(eq(bounties.id, bountyId));

		console.log(
			`[enrich] Enriched bounty ${bountyId} with ${files.length} files from ${owner}/${repo}`,
		);
	} catch (err) {
		// Enrichment is best-effort — don't fail the bounty
		console.error(`[enrich] Failed to enrich bounty ${bountyId}:`, err);
	}
}

/**
 * Identifies files likely relevant to the issue based on:
 * - File paths mentioned in the issue title/body
 * - Config/entry point files
 * - Source files matching the bounty language
 */
function identifyRelevantFiles(
	allFiles: Array<{ path: string; size: number }>,
	issueTitle: string,
	issueBody: string,
	language: string | null,
): string[] {
	const issueText = `${issueTitle} ${issueBody}`.toLowerCase();
	const allPaths = allFiles.map((f) => f.path);
	const relevant = new Set<string>();

	// Files explicitly mentioned in the issue
	for (const file of allPaths) {
		// Match full path
		if (issueText.includes(file.toLowerCase())) {
			relevant.add(file);
		}
		// Match filename
		const fileName = file.split("/").pop()?.toLowerCase() ?? "";
		if (fileName.length > 3 && issueText.includes(fileName)) {
			relevant.add(file);
		}
	}

	// Config/entry point files
	const configFiles = ["package.json", "tsconfig.json", "pyproject.toml", "Cargo.toml", "go.mod"];
	for (const cfg of configFiles) {
		if (allPaths.includes(cfg)) {
			relevant.add(cfg);
		}
	}

	// Source files matching language in common directories
	const langExtensions = getLanguageExtensions(language);
	const srcDirs = ["src/", "lib/", "app/", "pkg/", "internal/", "packages/"];
	for (const file of allPaths) {
		const inSrcDir = srcDirs.some((dir) => file.startsWith(dir));
		const matchesLang = langExtensions.some((ext) => file.endsWith(ext));
		const notTest = !file.includes("test") && !file.includes("spec");
		const notDist = !file.includes("dist/") && !file.includes("node_modules/");
		if (inSrcDir && matchesLang && notTest && notDist) {
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
	};
	return map[(language ?? "").toLowerCase()] ?? [".ts", ".js", ".py"];
}
