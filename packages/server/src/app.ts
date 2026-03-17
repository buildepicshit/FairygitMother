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
import { createDashboardRoutes } from "./dashboard/views.js";
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
