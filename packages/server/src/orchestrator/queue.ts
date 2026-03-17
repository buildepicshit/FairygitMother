import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, nodes, repos } from "../db/schema.js";

export interface QueuedBounty {
	id: string;
	owner: string;
	repo: string;
	issueNumber: number;
	issueTitle: string;
	issueBody: string;
	labels: string[];
	language: string | null;
	complexityEstimate: number;
	priority: number;
	lastRejectionReasons: Array<{ reasoning: string; issuesFound: string[] }> | null;
}

export async function enqueue(db: FairygitMotherDb, bountyId: string, priority?: number) {
	const update: Record<string, unknown> = { status: "queued" };
	if (priority !== undefined) {
		update.priority = priority;
	}
	await db.update(bounties).set(update).where(eq(bounties.id, bountyId));
}

export async function dequeueForNode(
	db: FairygitMotherDb,
	nodeId: string,
): Promise<QueuedBounty | null> {
	// Find the node's capabilities
	const node = (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
	if (!node) return null;

	const nodeCapabilities = node.capabilities as { languages: string[]; tools: string[] };

	// Build WHERE conditions — push language filtering to DB
	const conditions = [eq(bounties.status, "queued")];
	if (nodeCapabilities.languages.length > 0) {
		// Match bounties with no language OR bounties matching node's languages
		conditions.push(
			sql`(${bounties.language} IS NULL OR ${bounties.language} IN (${sql.join(
				nodeCapabilities.languages.map((l) => sql`${l}`),
				sql`, `,
			)}))`,
		);
	}

	const candidates = await db
		.select()
		.from(bounties)
		.where(and(...conditions))
		.orderBy(asc(bounties.priority), asc(bounties.complexityEstimate))
		.limit(20);

	for (const bounty of candidates) {
		// Check repo isn't blacklisted
		const repo = (
			await db
				.select()
				.from(repos)
				.where(and(eq(repos.owner, bounty.owner), eq(repos.name, bounty.repo)))
		)[0];
		if (repo?.blacklisted) continue;

		return {
			id: bounty.id,
			owner: bounty.owner,
			repo: bounty.repo,
			issueNumber: bounty.issueNumber,
			issueTitle: bounty.issueTitle,
			issueBody: bounty.issueBody,
			labels: bounty.labels as string[],
			language: bounty.language,
			complexityEstimate: bounty.complexityEstimate,
			priority: bounty.priority,
			lastRejectionReasons: bounty.lastRejectionReasons as QueuedBounty["lastRejectionReasons"],
		};
	}

	return null;
}

export async function markAssigned(db: FairygitMotherDb, bountyId: string, nodeId: string) {
	await db
		.update(bounties)
		.set({
			status: "assigned",
			assignedNodeId: nodeId,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(bounties.id, bountyId));
}

/**
 * Atomically dequeues and assigns a bounty to a node.
 * Uses UPDATE ... WHERE status = 'queued' with .returning() so that if another
 * node races to claim the same bounty, one of them gets 0 rows and tries next.
 */
const MAX_CLAIM_RETRIES = 5;

export async function dequeueAndAssign(
	db: FairygitMotherDb,
	nodeId: string,
	_retries = 0,
): Promise<QueuedBounty | null> {
	const bounty = await dequeueForNode(db, nodeId);
	if (!bounty) return null;

	// Validate issue is still open on GitHub before assigning
	const issueOpen = await isGitHubIssueOpen(bounty.owner, bounty.repo, bounty.issueNumber);
	if (!issueOpen) {
		// Issue was closed/resolved externally — remove from queue
		await db
			.update(bounties)
			.set({ status: "rejected", updatedAt: new Date().toISOString() })
			.where(eq(bounties.id, bounty.id));
		if (_retries >= MAX_CLAIM_RETRIES) return null;
		return dequeueAndAssign(db, nodeId, _retries + 1);
	}

	// Atomic claim: only succeeds if bounty is still queued
	const claimed = await db
		.update(bounties)
		.set({
			status: "assigned",
			assignedNodeId: nodeId,
			updatedAt: new Date().toISOString(),
		})
		.where(and(eq(bounties.id, bounty.id), eq(bounties.status, "queued")))
		.returning({ id: bounties.id });

	if (claimed.length === 0) {
		if (_retries >= MAX_CLAIM_RETRIES) return null;
		return dequeueAndAssign(db, nodeId, _retries + 1);
	}

	return bounty;
}

export async function requeue(db: FairygitMotherDb, bountyId: string) {
	const bounty = (await db.select().from(bounties).where(eq(bounties.id, bountyId)))[0];
	if (!bounty) return;

	await db
		.update(bounties)
		.set({
			status: "queued",
			assignedNodeId: null,
			retryCount: bounty.retryCount + 1,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(bounties.id, bountyId));
}

export async function requeueStaleBounties(
	db: FairygitMotherDb,
	staleAfterMs: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
	const stale = await db
		.select()
		.from(bounties)
		.where(and(eq(bounties.status, "assigned"), sql`${bounties.updatedAt} < ${cutoff}`));

	for (const bounty of stale) {
		await requeue(db, bounty.id);
	}

	return stale.length;
}

export async function requeueStaleDiffs(
	db: FairygitMotherDb,
	staleAfterMs: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
	const stale = await db
		.select()
		.from(bounties)
		.where(
			and(
				inArray(bounties.status, ["diff_submitted", "in_review"]),
				sql`${bounties.updatedAt} < ${cutoff}`,
			),
		);

	for (const bounty of stale) {
		await requeue(db, bounty.id);
	}

	return stale.length;
}

/**
 * Lightweight check if a GitHub issue is still open.
 * Uses the public API (no auth needed for public repos, 60 req/hr).
 * Returns true if open or if the check fails (fail-open to not block assignments).
 */
async function isGitHubIssueOpen(
	owner: string,
	repo: string,
	issueNumber: number,
): Promise<boolean> {
	try {
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
			headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "FairygitMother" },
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return true; // Fail-open: don't block on API errors
		const data = (await res.json()) as { state: string };
		return data.state === "open";
	} catch {
		return true; // Fail-open: network errors don't block assignments
	}
}

export async function getQueueDepth(db: FairygitMotherDb): Promise<number> {
	const result = (
		await db
			.select({ count: sql<number>`count(*)::int` })
			.from(bounties)
			.where(eq(bounties.status, "queued"))
	)[0];
	return result?.count ?? 0;
}
