import { eq } from "drizzle-orm";
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

export function applyReputationEvent(db: FairygitMotherDb, nodeId: string, event: ReputationEvent) {
	const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
	if (!node) return;

	const delta = SCORE_DELTAS[event];
	const newScore = Math.min(MAX_SCORE, Math.max(MIN_SCORE, node.reputationScore + delta));

	db.update(nodes).set({ reputationScore: newScore }).where(eq(nodes.id, nodeId)).run();
}

export function applyDailyDecay(db: FairygitMotherDb) {
	const allNodes = db.select().from(nodes).all();

	for (const node of allNodes) {
		const diff = node.reputationScore - DAILY_DECAY_TARGET;
		const decayed = node.reputationScore - diff * DAILY_DECAY_RATE;
		const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, decayed));

		db.update(nodes).set({ reputationScore: clamped }).where(eq(nodes.id, node.id)).run();
	}
}

export function isSuspended(db: FairygitMotherDb, nodeId: string): boolean {
	const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
	return node ? node.reputationScore < SUSPENSION_THRESHOLD : true;
}

export function isOnProbation(db: FairygitMotherDb, nodeId: string): boolean {
	const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
	if (!node) return true;
	return node.totalBountiesSolved < PROBATION_THRESHOLD;
}

export function getConsensusRequirement(db: FairygitMotherDb, nodeId: string): number {
	return isOnProbation(db, nodeId) ? 3 : 2;
}

export function getReputation(db: FairygitMotherDb, nodeId: string): number {
	const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
	return node?.reputationScore ?? 0;
}
