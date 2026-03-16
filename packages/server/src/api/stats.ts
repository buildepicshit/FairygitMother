import { Hono } from "hono";
import { eq, sql, gte, ne } from "drizzle-orm";
import type { GridStats } from "@fairygitmother/core";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, nodes, consensusResults, submissions } from "../db/schema.js";

export function createStatsRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// GET /api/v1/stats
	app.get("/", (c) => {
		const stats = getGridStats(db);
		return c.json(stats);
	});

	return app;
}

export function getGridStats(db: FairygitMotherDb): GridStats {
	const activeNodes =
		db
			.select({ count: sql<number>`count(*)` })
			.from(nodes)
			.where(ne(nodes.status, "offline"))
			.get()?.count ?? 0;

	const totalNodes =
		db.select({ count: sql<number>`count(*)` }).from(nodes).get()?.count ?? 0;

	const queueDepth =
		db
			.select({ count: sql<number>`count(*)` })
			.from(bounties)
			.where(eq(bounties.status, "queued"))
			.get()?.count ?? 0;

	const bountiesInProgress =
		db
			.select({ count: sql<number>`count(*)` })
			.from(bounties)
			.where(eq(bounties.status, "in_progress"))
			.get()?.count ?? 0;

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);

	const prsToday =
		db
			.select({ count: sql<number>`count(*)` })
			.from(consensusResults)
			.where(gte(consensusResults.decidedAt, todayStart.toISOString()))
			.get()?.count ?? 0;

	const prsAllTime =
		db
			.select({ count: sql<number>`count(*)` })
			.from(consensusResults)
			.where(eq(consensusResults.outcome, "approved"))
			.get()?.count ?? 0;

	const tokenSum =
		db
			.select({ total: sql<number>`COALESCE(SUM(${nodes.totalTokensDonated}), 0)` })
			.from(nodes)
			.get()?.total ?? 0;

	const avgSolve =
		db
			.select({
				avg: sql<number>`COALESCE(AVG(${submissions.solveDurationMs}), 0)`,
			})
			.from(submissions)
			.get()?.avg ?? 0;

	const totalApproved =
		db
			.select({ count: sql<number>`count(*)` })
			.from(consensusResults)
			.where(eq(consensusResults.outcome, "approved"))
			.get()?.count ?? 0;

	const totalDecided =
		db.select({ count: sql<number>`count(*)` }).from(consensusResults).get()?.count ?? 0;

	return {
		activeNodes,
		totalNodes,
		queueDepth,
		bountiesInProgress,
		prsSubmittedToday: prsToday,
		prsSubmittedAllTime: prsAllTime,
		totalTokensDonated: tokenSum,
		averageSolveTimeMs: Math.round(avgSolve),
		mergeRate: totalDecided > 0 ? totalApproved / totalDecided : 0,
	};
}
