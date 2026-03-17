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
}

export async function enqueue(db: FairygitMotherDb, bountyId: string, priority?: number) {
	if (priority !== undefined) {
		await db.update(bounties).set({ priority, status: "queued" }).where(eq(bounties.id, bountyId));
	} else {
		await db.update(bounties).set({ status: "queued" }).where(eq(bounties.id, bountyId));
	}
}

export async function dequeueForNode(
	db: FairygitMotherDb,
	nodeId: string,
): Promise<QueuedBounty | null> {
	// Find the node's capabilities
	const node = (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
	if (!node) return null;

	const nodeCapabilities = node.capabilities as { languages: string[]; tools: string[] };

	// Get highest priority queued bounty matching node capabilities
	const allQueued = await db
		.select()
		.from(bounties)
		.where(eq(bounties.status, "queued"))
		.orderBy(asc(bounties.priority), asc(bounties.complexityEstimate));

	for (const bounty of allQueued) {
		// Check language match if node has language preferences
		if (
			nodeCapabilities.languages.length > 0 &&
			bounty.language &&
			!nodeCapabilities.languages.includes(bounty.language)
		) {
			continue;
		}

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

export async function getQueueDepth(db: FairygitMotherDb): Promise<number> {
	const result = (
		await db
			.select({ count: sql<number>`count(*)::int` })
			.from(bounties)
			.where(eq(bounties.status, "queued"))
	)[0];
	return result?.count ?? 0;
}
