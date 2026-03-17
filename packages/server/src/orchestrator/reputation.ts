import { eq, sql } from "drizzle-orm";
import type { FairygitMotherDb } from "../db/client.js";
import { nodes } from "../db/schema.js";

// ── Score deltas ───────────────────────────────────────────────

const SCORE_DELTAS = {
	fix_merged: 5,
	fix_closed: -3,
	review_accurate: 2,
	review_inaccurate: -1.5,
} as const;

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const DAILY_DECAY_TARGET = 50;
const DAILY_DECAY_RATE = 0.02;
const SUSPENSION_THRESHOLD = 10;
const PROBATION_THRESHOLD = 5; // First N merges need 3-of-3

export type ReputationEvent = keyof typeof SCORE_DELTAS;

export async function applyReputationEvent(
	db: FairygitMotherDb,
	nodeId: string,
	event: ReputationEvent,
) {
	const delta = SCORE_DELTAS[event];
	// Atomic: no read-modify-write race
	await db
		.update(nodes)
		.set({
			reputationScore: sql`LEAST(${MAX_SCORE}, GREATEST(${MIN_SCORE}, ${nodes.reputationScore} + ${delta}))`,
		})
		.where(eq(nodes.id, nodeId));
}

export async function applyDailyDecay(db: FairygitMotherDb) {
	const allNodes = await db.select().from(nodes);

	for (const node of allNodes) {
		const diff = node.reputationScore - DAILY_DECAY_TARGET;
		const decayed = node.reputationScore - diff * DAILY_DECAY_RATE;
		const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, decayed));

		await db.update(nodes).set({ reputationScore: clamped }).where(eq(nodes.id, node.id));
	}
}

export async function isSuspended(db: FairygitMotherDb, nodeId: string): Promise<boolean> {
	const node = (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
	return node ? node.reputationScore < SUSPENSION_THRESHOLD : true;
}

export async function isOnProbation(db: FairygitMotherDb, nodeId: string): Promise<boolean> {
	const node = (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
	if (!node) return true;
	return node.totalBountiesSolved < PROBATION_THRESHOLD;
}

export async function getConsensusRequirement(
	db: FairygitMotherDb,
	nodeId: string,
): Promise<number> {
	return (await isOnProbation(db, nodeId)) ? 3 : 2;
}

export async function getReputation(db: FairygitMotherDb, nodeId: string): Promise<number> {
	const node = (await db.select().from(nodes).where(eq(nodes.id, nodeId)))[0];
	return node?.reputationScore ?? 0;
}
