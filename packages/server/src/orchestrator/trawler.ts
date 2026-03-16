import { type GitHubClient, type GitHubIssue, generateId } from "@fairygitmother/core";
import { and, eq } from "drizzle-orm";
import { emitEvent } from "../api/feed.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, repos } from "../db/schema.js";

const QUALIFYING_LABELS = ["good first issue", "help wanted", "fairygitmother"];

export interface TrawlerOptions {
	db: FairygitMotherDb;
	github: GitHubClient;
}

export async function scanRepo(opts: TrawlerOptions, owner: string, repo: string): Promise<number> {
	const { db, github } = opts;
	const issues = await github.fetchGoodFirstIssues(owner, repo, 20);
	let created = 0;

	for (const issue of issues) {
		if (!isEligible(issue)) continue;

		const existing = db
			.select()
			.from(bounties)
			.where(
				and(
					eq(bounties.owner, owner),
					eq(bounties.repo, repo),
					eq(bounties.issueNumber, issue.number),
				),
			)
			.get();

		if (existing) continue;

		const language = await github.getRepoLanguages(owner, repo).then((langs) => {
			const entries = Object.entries(langs);
			return entries.length > 0 ? entries[0][0] : null;
		});

		const bounty = {
			id: generateId("bty"),
			owner,
			repo,
			issueNumber: issue.number,
			issueTitle: issue.title,
			issueBody: issue.body ?? "",
			labels: issue.labels.map((l) => l.name),
			language,
			complexityEstimate: estimateComplexity(issue),
			status: "queued" as const,
			assignedNodeId: null,
			priority: 50,
			retryCount: 0,
		};

		db.insert(bounties).values(bounty).run();
		created++;

		emitEvent({
			type: "bounty_created",
			bounty: {
				...bounty,
				repoUrl: `https://github.com/${owner}/${repo}`,
				createdAt: new Date().toISOString(),
			},
		});
	}

	// Update last trawled time for repo
	db.update(repos)
		.set({ lastTrawledAt: new Date().toISOString() })
		.where(and(eq(repos.owner, owner), eq(repos.name, repo)))
		.run();

	return created;
}

export function isEligible(issue: GitHubIssue): boolean {
	// Must have a qualifying label
	const hasLabel = issue.labels.some((l) => QUALIFYING_LABELS.includes(l.name.toLowerCase()));
	if (!hasLabel) return false;

	// Must not be assigned
	if (issue.assignee) return false;

	// Must not be a PR
	if (issue.pull_request) return false;

	return true;
}

export function estimateComplexity(issue: GitHubIssue): number {
	const bodyLength = (issue.body ?? "").length;
	const labels = issue.labels.map((l) => l.name.toLowerCase());

	// Low complexity indicators
	if (labels.includes("typo") || labels.includes("documentation")) return 1;

	// High complexity indicators
	if (labels.includes("breaking-change") || labels.includes("refactor")) return 4;

	// Body length heuristic
	if (bodyLength < 100) return 1;
	if (bodyLength < 500) return 2;
	if (bodyLength < 2000) return 3;
	return 4;
}
