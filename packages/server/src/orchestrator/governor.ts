import type { FairygitMotherConfig } from "@fairygitmother/core";
import { and, eq, gte, sql } from "drizzle-orm";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, repos } from "../db/schema.js";

// ── Blocked patterns for diff safety ───────────────────────────

const BLOCKED_PATTERNS = [
	/(?:password|secret|api_key|token)\s*[:=]\s*['"][^'"]+['"]/i,
	/\beval\s*\(/,
	/\bexec\s*\(/,
	/child_process/,
	/subprocess\.(run|call|Popen)/,
	/os\.system\s*\(/,
	/\brm\s+-rf\b/,
	/curl\s+.*\|\s*(?:sh|bash)/,
];

const BLOCKED_EXTENSIONS = [".exe", ".dll", ".so", ".dylib", ".key", ".pem", ".p12", ".pfx"];

export interface SafetyCheckResult {
	safe: boolean;
	issues: string[];
}

export function checkDiffSafety(
	diff: string,
	filesChanged: string[],
	config: FairygitMotherConfig,
): SafetyCheckResult {
	const issues: string[] = [];

	// Check diff size
	const lines = diff.split("\n").length;
	if (lines > config.maxDiffLines) {
		issues.push(`Diff too large: ${lines} lines (max ${config.maxDiffLines})`);
	}

	// Check file count
	if (filesChanged.length > config.maxDiffFiles) {
		issues.push(`Too many files changed: ${filesChanged.length} (max ${config.maxDiffFiles})`);
	}

	// Check blocked extensions
	for (const file of filesChanged) {
		const ext = file.substring(file.lastIndexOf("."));
		if (BLOCKED_EXTENSIONS.includes(ext)) {
			issues.push(`Blocked file extension: ${file}`);
		}
	}

	// Check blocked patterns in diff
	for (const pattern of BLOCKED_PATTERNS) {
		if (pattern.test(diff)) {
			issues.push(`Blocked pattern found in diff: ${pattern.source}`);
		}
	}

	return { safe: issues.length === 0, issues };
}

export async function canSubmitPrForRepo(
	db: FairygitMotherDb,
	owner: string,
	repo: string,
	maxPerDay: number,
): Promise<boolean> {
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);

	const result = (
		await db
			.select({ count: sql<number>`count(*)` })
			.from(consensusResults)
			.innerJoin(
				bounties,
				eq(
					consensusResults.submissionId,
					sql`(SELECT id FROM submissions WHERE bounty_id = ${bounties.id} LIMIT 1)`,
				),
			)
			.where(
				and(
					eq(bounties.owner, owner),
					eq(bounties.repo, repo),
					eq(consensusResults.outcome, "approved"),
					gte(consensusResults.decidedAt, todayStart.toISOString()),
				),
			)
	)[0];

	return (result?.count ?? 0) < maxPerDay;
}

export async function isRepoBlacklisted(
	db: FairygitMotherDb,
	owner: string,
	repo: string,
): Promise<boolean> {
	const repoRow = (
		await db
			.select()
			.from(repos)
			.where(and(eq(repos.owner, owner), eq(repos.name, repo)))
	)[0];

	return repoRow?.blacklisted ?? false;
}

export async function incrementRejects(db: FairygitMotherDb, owner: string, repo: string) {
	const repoRow = (
		await db
			.select()
			.from(repos)
			.where(and(eq(repos.owner, owner), eq(repos.name, repo)))
	)[0];

	if (!repoRow) return;

	const newCount = repoRow.consecutiveRejects + 1;
	const blacklist = newCount >= 5;

	await db
		.update(repos)
		.set({
			consecutiveRejects: newCount,
			blacklisted: blacklist,
		})
		.where(eq(repos.id, repoRow.id));
}

export async function resetRejects(db: FairygitMotherDb, owner: string, repo: string) {
	await db
		.update(repos)
		.set({ consecutiveRejects: 0 })
		.where(and(eq(repos.owner, owner), eq(repos.name, repo)));
}
