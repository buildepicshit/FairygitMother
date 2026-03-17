import type { GridStats } from "@fairygitmother/core";
import { and, eq, gte, ne, sql } from "drizzle-orm";
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

	const totalNodes =
		(await db.select({ count: sql<number>`count(*)::int` }).from(nodes))[0]?.count ?? 0;

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
				.where(eq(bounties.status, "assigned"))
		)[0]?.count ?? 0;

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);

	const prsToday =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(consensusResults)
				.where(
					and(
						eq(consensusResults.outcome, "approved"),
						gte(consensusResults.decidedAt, todayStart.toISOString()),
					),
				)
		)[0]?.count ?? 0;

	const totalApproved =
		(
			await db
				.select({ count: sql<number>`count(*)::int` })
				.from(consensusResults)
				.where(eq(consensusResults.outcome, "approved"))
		)[0]?.count ?? 0;

	const nodeTokenSum =
		(
			await db
				.select({ total: sql<number>`COALESCE(SUM(${nodes.totalTokensDonated}), 0)::int` })
				.from(nodes)
		)[0]?.total ?? 0;

	// Also sum from submissions table as a floor — catches tokens that were
	// recorded in submissions but never promoted to node counters
	const submissionTokenSum =
		(
			await db
				.select({ total: sql<number>`COALESCE(SUM(${submissions.tokensUsed}), 0)::int` })
				.from(submissions)
		)[0]?.total ?? 0;

	const tokenSum = Math.max(nodeTokenSum, submissionTokenSum);

	const avgSolve =
		(
			await db
				.select({
					avg: sql<number>`COALESCE(AVG(${submissions.solveDurationMs}), 0)::int`,
				})
				.from(submissions)
		)[0]?.avg ?? 0;

	const totalDecided =
		(await db.select({ count: sql<number>`count(*)::int` }).from(consensusResults))[0]?.count ?? 0;

	const bountiesSolvedSum =
		(
			await db
				.select({ total: sql<number>`COALESCE(SUM(${nodes.totalBountiesSolved}), 0)::int` })
				.from(nodes)
		)[0]?.total ?? 0;

	const reviewSum =
		(
			await db
				.select({ total: sql<number>`COALESCE(SUM(${nodes.totalReviewsDone}), 0)::int` })
				.from(nodes)
		)[0]?.total ?? 0;

	const base = statsBaseline;

	return {
		activeNodes,
		totalNodes,
		queueDepth,
		bountiesInProgress,
		prsSubmittedToday: prsToday,
		prsSubmittedAllTime: totalApproved + (base?.totalPrsSubmitted ?? 0),
		totalTokensDonated: tokenSum + (base?.totalTokensDonated ?? 0),
		totalBountiesSolved: Math.max(bountiesSolvedSum, base?.totalBountiesSolved ?? 0),
		totalReviewsDone: Math.max(reviewSum, base?.totalReviewsDone ?? 0),
		averageSolveTimeMs: Math.round(avgSolve),
		mergeRate: totalDecided > 0 ? totalApproved / totalDecided : 0,
	};
}
