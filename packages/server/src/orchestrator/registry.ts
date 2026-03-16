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

export function registerNode(
	db: FairygitMotherDb,
	displayName: string | null,
	capabilities: NodeCapabilities,
	solverBackend: string,
): RegisteredNode {
	const id = generateId("node");
	const apiKey = generateApiKey();

	db.insert(nodes)
		.values({
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
		})
		.run();

	emitEvent({ type: "node_joined", nodeId: id, displayName });
	logAudit(db, "node_registered", id, { displayName, solverBackend });

	return { id, apiKey };
}

export function heartbeat(
	db: FairygitMotherDb,
	nodeId: string,
	status: "idle" | "busy" | "reviewing",
	tokensSinceLastHeartbeat: number,
) {
	const now = new Date().toISOString();
	db.update(nodes)
		.set({
			status,
			lastHeartbeat: now,
			totalTokensDonated: sql`${nodes.totalTokensDonated} + ${tokensSinceLastHeartbeat}`,
		})
		.where(eq(nodes.id, nodeId))
		.run();
}

export function findNodeByApiKey(db: FairygitMotherDb, apiKey: string) {
	return db.select().from(nodes).where(eq(nodes.apiKey, apiKey)).get();
}

export function getNode(db: FairygitMotherDb, nodeId: string) {
	return db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
}

export function removeNode(db: FairygitMotherDb, nodeId: string) {
	db.update(nodes).set({ status: "offline" }).where(eq(nodes.id, nodeId)).run();
	emitEvent({ type: "node_left", nodeId });
	logAudit(db, "node_pruned", nodeId, { reason: "removed" });
}

export function matchBountyToNode(db: FairygitMotherDb, language: string | null): string | null {
	const idleNodes = db.select().from(nodes).where(eq(nodes.status, "idle")).all();

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

export function pruneStaleNodes(db: FairygitMotherDb, timeoutMs: number) {
	const cutoff = new Date(Date.now() - timeoutMs).toISOString();
	const stale = db
		.select()
		.from(nodes)
		.where(and(lt(nodes.lastHeartbeat, cutoff), ne(nodes.status, "offline")))
		.all();

	for (const node of stale) {
		db.update(nodes).set({ status: "offline" }).where(eq(nodes.id, node.id)).run();
		emitEvent({ type: "node_left", nodeId: node.id });
		logAudit(db, "node_pruned", node.id, { reason: "stale", lastHeartbeat: node.lastHeartbeat });
	}

	return stale.length;
}

export function getActiveNodeCount(db: FairygitMotherDb): number {
	const result = db
		.select({ count: sql<number>`count(*)` })
		.from(nodes)
		.where(ne(nodes.status, "offline"))
		.get();
	return result?.count ?? 0;
}

export function getTotalNodeCount(db: FairygitMotherDb): number {
	const result = db.select({ count: sql<number>`count(*)` }).from(nodes).get();
	return result?.count ?? 0;
}
