import { and, asc, eq, sql } from "drizzle-orm";
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

export function enqueue(db: FairygitMotherDb, bountyId: string, priority?: number) {
	if (priority !== undefined) {
		db.update(bounties).set({ priority, status: "queued" }).where(eq(bounties.id, bountyId)).run();
	} else {
		db.update(bounties).set({ status: "queued" }).where(eq(bounties.id, bountyId)).run();
	}
}

export function dequeueForNode(db: FairygitMotherDb, nodeId: string): QueuedBounty | null {
	// Find the node's capabilities
	const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
	if (!node) return null;

	const nodeCapabilities = node.capabilities as { languages: string[]; tools: string[] };

	// Get highest priority queued bounty matching node capabilities
	const allQueued = db
		.select()
		.from(bounties)
		.where(eq(bounties.status, "queued"))
		.orderBy(asc(bounties.priority), asc(bounties.complexityEstimate))
		.all();

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
		const repo = db
			.select()
			.from(repos)
			.where(and(eq(repos.owner, bounty.owner), eq(repos.name, bounty.repo)))
			.get();
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

export function markAssigned(db: FairygitMotherDb, bountyId: string, nodeId: string) {
	db.update(bounties)
		.set({
			status: "assigned",
			assignedNodeId: nodeId,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(bounties.id, bountyId))
		.run();
}

export function requeue(db: FairygitMotherDb, bountyId: string) {
	const bounty = db.select().from(bounties).where(eq(bounties.id, bountyId)).get();
	if (!bounty) return;

	db.update(bounties)
		.set({
			status: "queued",
			assignedNodeId: null,
			retryCount: bounty.retryCount + 1,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(bounties.id, bountyId))
		.run();
}

export function requeueStaleBounties(db: FairygitMotherDb, staleAfterMs: number): number {
	const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
	const stale = db
		.select()
		.from(bounties)
		.where(and(eq(bounties.status, "assigned"), sql`${bounties.updatedAt} < ${cutoff}`))
		.all();

	for (const bounty of stale) {
		requeue(db, bounty.id);
	}

	return stale.length;
}

export function requeueStaleDiffs(db: FairygitMotherDb, staleAfterMs: number): number {
	const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
	const stale = db
		.select()
		.from(bounties)
		.where(and(eq(bounties.status, "diff_submitted"), sql`${bounties.updatedAt} < ${cutoff}`))
		.all();

	for (const bounty of stale) {
		requeue(db, bounty.id);
	}

	return stale.length;
}

export function getQueueDepth(db: FairygitMotherDb): number {
	const result = db
		.select({ count: sql<number>`count(*)` })
		.from(bounties)
		.where(eq(bounties.status, "queued"))
		.get();
	return result?.count ?? 0;
}
