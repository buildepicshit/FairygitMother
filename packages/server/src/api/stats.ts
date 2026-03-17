import type { GridStats } from "@fairygitmother/core";
import { eq, gte, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes, submissions } from "../db/schema.js";
import type { PersistedStats } from "../stats-persistence.js";

let statsBaseline: PersistedStats | null = null;

export function setStatsBaseline(baseline: PersistedStats) {
	statsBaseline = baseline;
}

export function createStatsRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// GET /api/v1/stats
	app.get("/", async (c) => {
		const stats = await getGridStats(db);
		return c.json(stats);
	});

	return app;
}

export async function getGridStats(db: FairygitMotherDb): Promise<GridStats> {
	const activeNodes =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(nodes)
				.where(ne(nodes.status, "offline"))
		)[0]?.count ?? 0;

	const totalNodes = (await db.select({ count: sql<number>`count(*)::int` }).from(nodes))[0]?.count ?? 0;

	const queueDepth =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(bounties)
				.where(eq(bounties.status, "queued"))
		)[0]?.count ?? 0;

	const bountiesInProgress =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(bounties)
				.where(eq(bounties.status, "in_progress"))
		)[0]?.count ?? 0;

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);

	const prsToday =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(consensusResults)
				.where(gte(consensusResults.decidedAt, todayStart.toISOString()))
		)[0]?.count ?? 0;

	const prsAllTime =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(consensusResults)
				.where(eq(consensusResults.outcome, "approved"))
		)[0]?.count ?? 0;

	const tokenSum =
		(
			await db
				.select({ total: sql<number>`COALESCE(SUM(${nodes.totalTokensDonated}), 0)::int` })
				.from(nodes)
		)[0]?.total ?? 0;

	const avgSolve =
		(
			await db
				.select({
					avg: sql<number>`COALESCE(AVG(${submissions.solveDurationMs}), 0)::int`,
				})
				.from(submissions)
		)[0]?.avg ?? 0;

	const totalApproved =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(consensusResults)
				.where(eq(consensusResults.outcome, "approved"))
		)[0]?.count ?? 0;

	const totalDecided =
		(await db.select({ count: sql<number>`count(*)::int` }).from(consensusResults))[0]?.count ?? 0;

	const base = statsBaseline;

	return {
		activeNodes,
		totalNodes,
		queueDepth,
		bountiesInProgress,
		prsSubmittedToday: prsToday,
		prsSubmittedAllTime: prsAllTime + (base?.totalPrsSubmitted ?? 0),
		totalTokensDonated: tokenSum + (base?.totalTokensDonated ?? 0),
		averageSolveTimeMs: Math.round(avgSolve),
		mergeRate: totalDecided > 0 ? totalApproved / totalDecided : 0,
	};
}
