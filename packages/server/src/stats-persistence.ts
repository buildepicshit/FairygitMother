import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getGridStats } from "./api/stats.js";
import type { FairygitMotherDb } from "./db/client.js";

export interface PersistedStats {
	totalTokensDonated: number;
	totalBountiesSolved: number;
	totalPrsSubmitted: number;
	totalReviewsDone: number;
	lastSnapshotAt: string;
}

const DEFAULT_STATS: PersistedStats = {
	totalTokensDonated: 0,
	totalBountiesSolved: 0,
	totalPrsSubmitted: 0,
	totalReviewsDone: 0,
	lastSnapshotAt: new Date().toISOString(),
};

/**
 * Load persisted stats from a JSON file.
 * Returns defaults if the file doesn't exist.
 */
export function loadPersistedStats(filePath: string): PersistedStats {
	try {
		if (existsSync(filePath)) {
			const raw = readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw);
			console.log(`[stats] Loaded persisted stats from ${filePath}`);
			return { ...DEFAULT_STATS, ...parsed };
		}
	} catch (err) {
		console.error(`[stats] Failed to load persisted stats: ${err}`);
	}
	return { ...DEFAULT_STATS };
}

/**
 * Save current stats to a JSON file.
 * Merges live DB stats with the persisted baseline (takes the max of each counter).
 */
export async function savePersistedStats(
	filePath: string,
	db: FairygitMotherDb,
	baseline: PersistedStats,
): Promise<PersistedStats> {
	const live = await getGridStats(db);

	const updated: PersistedStats = {
		totalTokensDonated: Math.max(baseline.totalTokensDonated, live.totalTokensDonated),
		totalBountiesSolved: Math.max(baseline.totalBountiesSolved, live.prsSubmittedAllTime),
		totalPrsSubmitted: Math.max(baseline.totalPrsSubmitted, live.prsSubmittedAllTime),
		totalReviewsDone: Math.max(baseline.totalReviewsDone, 0),
		lastSnapshotAt: new Date().toISOString(),
	};

	try {
		// Ensure directory exists
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			const { mkdirSync } = require("node:fs");
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(filePath, JSON.stringify(updated, null, 2));
		console.log(`[stats] Saved persisted stats to ${filePath}`);
	} catch (err) {
		console.error(`[stats] Failed to save persisted stats: ${err}`);
	}

	return updated;
}
