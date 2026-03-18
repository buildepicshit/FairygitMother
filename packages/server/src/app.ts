import { createGitHubClient } from "@fairygitmother/core";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createBountyRoutes } from "./api/bounties.js";
import { nodeWsRouteHandler } from "./api/node-push.js";
import { createNodeRoutes } from "./api/nodes.js";
import { createReviewRoutes } from "./api/reviews.js";
import { createStatsRoutes } from "./api/stats.js";
import { feedRouteHandler } from "./api/websocket.js";
import type { PrSubmitContext } from "./consensus/aggregator.js";
import { createDashboardRoutes } from "./dashboard/index.js";
import type { FairygitMotherDb } from "./db/client.js";
import {
	auditLog,
	bounties,
	consensusResults,
	nodes,
	repos,
	submissions,
	votes,
} from "./db/schema.js";
import { authMiddleware } from "./middleware/auth.js";
import { createRateLimiter } from "./middleware/ratelimit.js";

export function createApp(db: FairygitMotherDb, prContext?: PrSubmitContext) {
	const app = new Hono();

	// Middleware
	app.use("*", logger());
	app.use("/api/*", cors());
	app.use("/api/*", createRateLimiter());
	app.use("/api/*", authMiddleware(db));

	// Health check
	app.get("/api/v1/health", (c) => {
		return c.json({ status: "ok", timestamp: new Date().toISOString() });
	});

	// Admin reset — protected by secret. Remove after initial launch.
	app.post("/api/v1/admin/reset", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		if (body.secret !== process.env.ADMIN_SECRET) {
			return c.json({ error: "Forbidden" }, 403);
		}
		await db.delete(auditLog);
		await db.delete(consensusResults);
		await db.delete(votes);
		await db.delete(submissions);
		await db.delete(bounties);
		await db.delete(nodes);
		await db.delete(repos);
		return c.json({ status: "reset", timestamp: new Date().toISOString() });
	});

	// Admin: selective cleanup — delete specific bounties or prune ghost nodes
	app.post("/api/v1/admin/cleanup", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		if (body.secret !== process.env.ADMIN_SECRET) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const results: Record<string, unknown> = {};

		// Delete specific bounties by ID
		if (body.deleteBounties?.length) {
			for (const id of body.deleteBounties) {
				await db
					.delete(votes)
					.where(
						inArray(
							votes.submissionId,
							db
								.select({ id: submissions.id })
								.from(submissions)
								.where(eq(submissions.bountyId, id)),
						),
					);
				await db
					.delete(consensusResults)
					.where(
						inArray(
							consensusResults.submissionId,
							db
								.select({ id: submissions.id })
								.from(submissions)
								.where(eq(submissions.bountyId, id)),
						),
					);
				await db.delete(submissions).where(eq(submissions.bountyId, id));
				await db.delete(bounties).where(eq(bounties.id, id));
			}
			results.deletedBounties = body.deleteBounties;
		}

		// Delete specific nodes by ID
		if (body.deleteNodes?.length) {
			for (const id of body.deleteNodes) {
				await db.delete(nodes).where(eq(nodes.id, id));
			}
			results.deletedNodes = body.deleteNodes;
		}

		// Prune all nodes (cascades through votes, consensus, submissions)
		if (body.pruneAllNodes) {
			await db.delete(auditLog);
			await db.delete(consensusResults);
			await db.delete(votes);
			await db.delete(submissions);
			const allNodes = await db.select({ id: nodes.id }).from(nodes);
			await db.delete(nodes);
			results.prunedNodes = allNodes.length;
		}

		return c.json({ status: "cleaned", ...results });
	});

	// Admin: close a PR and optionally comment (uses bot's GITHUB_TOKEN)
	app.post("/api/v1/admin/close-pr", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		if (body.secret !== process.env.ADMIN_SECRET) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const { owner, repo, prNumber, comment } = body;
		if (!owner || !repo || !prNumber) {
			return c.json({ error: "owner, repo, prNumber required" }, 400);
		}

		const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
		if (!token) {
			return c.json({ error: "No GITHUB_TOKEN configured on server" }, 500);
		}

		const github = createGitHubClient(token);
		if (comment) {
			await github.commentOnIssue(owner, repo, prNumber, comment);
		}
		await github.closePullRequest(owner, repo, prNumber);

		return c.json({ closed: true, owner, repo, prNumber });
	});

	// Admin: requeue a bounty with optional feedback context
	app.post("/api/v1/admin/requeue", async (c) => {
		const body = await c.req.json().catch(() => ({}));
		if (body.secret !== process.env.ADMIN_SECRET) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const { bountyId, feedback } = body;
		if (!bountyId) {
			return c.json({ error: "bountyId required" }, 400);
		}

		const bounty = (await db.select().from(bounties).where(eq(bounties.id, bountyId)))[0];
		if (!bounty) {
			return c.json({ error: "Bounty not found" }, 404);
		}

		const rejectionReasons = feedback
			? [{ reasoning: feedback, issuesFound: [] as string[] }]
			: undefined;

		await db
			.update(bounties)
			.set({
				status: "queued",
				assignedNodeId: null,
				retryCount: bounty.retryCount + 1,
				submissionCount: 0,
				...(rejectionReasons && { lastRejectionReasons: rejectionReasons }),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(bounties.id, bountyId));

		return c.json({
			status: "requeued",
			bountyId,
			retryCount: bounty.retryCount + 1,
		});
	});

	// Real-time feed (WebSocket upgrade — plain HTTP gets 426)
	app.get("/api/v1/feed", feedRouteHandler);
	app.get("/api/v1/nodes/ws", nodeWsRouteHandler);

	// API routes
	app.route("/api/v1/nodes", createNodeRoutes(db));
	app.route("/api/v1/bounties", createBountyRoutes(db));
	app.route("/api/v1/reviews", createReviewRoutes(db, prContext));
	app.route("/api/v1/stats", createStatsRoutes(db));

	// Dashboard
	app.route("/", createDashboardRoutes(db));

	return app;
}
