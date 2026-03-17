import { type NodeCapabilities, generateApiKey, generateId } from "@fairygitmother/core";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { emitEvent } from "../api/feed.js";
import { logAudit } from "../audit.js";
import type { FairygitMotherDb } from "../db/client.js";
import { nodes } from "../db/schema.js";

export interface RegisteredNode {
	id: string;
	apiKey: string;
}

export async function registerNode(
	db: FairygitMotherDb,
	displayName: string | null,
	capabilities: NodeCapabilities,
	solverBackend: string,
): Promise<RegisteredNode> {
	const id = generateId("node");
	const apiKey = generateApiKey();

	await db.insert(nodes).values({
		id,
		displayName,
		apiKey,
		capabilities,
		solverBackend,
		status: "idle",
		reputationScore: 50,
		totalTokensDonated: 0,
		totalBountiesSolved: 0,
		totalReviewsDone: 0,
	});

	emitEvent({ type: "node_joined", nodeId: id, displayName });
	await logAudit(db, "node_registered", id, { displayName, solverBackend });

	return { id, apiKey };
}

export async function heartbeat(
	db: FairygitMotherDb,
	nodeId: string,
	status: "idle" | "busy" | "reviewing",
	tokensSinceLastHeartbeat: number,
) {
	const now = new Date().toISOString();
	await db
		.update(nodes)
		.set({
			status,
			lastHeartbeat: now,
			totalTokensDonated: sql`${nodes.totalTokensDonated} + ${tokensSinceLastHeartbeat}`,
		})
		.where(eq(nodes.id, nodeId));
}

export async function findNodeByApiKey(db: FairygitMotherDb, apiKey: string) {
	return (await db.select().from(nodes).where(eq(nodes.apiKey, apiKey)))[0];
}

export async function getNode(db: FairygitMotherDb, nodeId: string) {
	return (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
}

export async function removeNode(db: FairygitMotherDb, nodeId: string) {
	await db.update(nodes).set({ status: "offline" }).where(eq(nodes.id, nodeId));
	emitEvent({ type: "node_left", nodeId });
	await logAudit(db, "node_pruned", nodeId, { reason: "removed" });
}

export async function matchBountyToNode(
	db: FairygitMotherDb,
	language: string | null,
): Promise<string | null> {
	const idleNodes = await db.select().from(nodes).where(eq(nodes.status, "idle"));

	if (idleNodes.length === 0) return null;

	// Sort by reputation (best first), then filter by language capability
	const candidates = idleNodes
		.filter((node) => {
			if (!language) return true;
			const caps = node.capabilities as { languages: string[]; tools: string[] };
			return caps.languages.length === 0 || caps.languages.includes(language);
		})
		.sort((a, b) => b.reputationScore - a.reputationScore);

	return candidates.length > 0 ? candidates[0].id : null;
}

export async function pruneStaleNodes(db: FairygitMotherDb, timeoutMs: number): Promise<number> {
	const cutoff = new Date(Date.now() - timeoutMs).toISOString();
	const stale = await db
		.select()
		.from(nodes)
		.where(and(lt(nodes.lastHeartbeat, cutoff), ne(nodes.status, "offline")));

	for (const node of stale) {
		await db.update(nodes).set({ status: "offline" }).where(eq(nodes.id, node.id));
		emitEvent({ type: "node_left", nodeId: node.id });
		await logAudit(db, "node_pruned", node.id, {
			reason: "stale",
			lastHeartbeat: node.lastHeartbeat,
		});
	}

	return stale.length;
}

export async function getActiveNodeCount(db: FairygitMotherDb): Promise<number> {
	const result = (
		await db.select({ count: sql<number>`count(*)::int` }).from(nodes).where(ne(nodes.status, "offline"))
	)[0];
	return result?.count ?? 0;
}

export async function getTotalNodeCount(db: FairygitMotherDb): Promise<number> {
	const result = (await db.select({ count: sql<number>`count(*)::int` }).from(nodes))[0];
	return result?.count ?? 0;
}
