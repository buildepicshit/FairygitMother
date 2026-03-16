import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { FairygitMotherDb } from "./db/client.js";
import { createNodeRoutes } from "./api/nodes.js";
import { createBountyRoutes } from "./api/bounties.js";
import { createReviewRoutes } from "./api/reviews.js";
import { createStatsRoutes } from "./api/stats.js";
import { createDashboardRoutes } from "./dashboard/views.js";
import { authMiddleware } from "./middleware/auth.js";
import { createRateLimiter } from "./middleware/ratelimit.js";
import { feedRouteHandler } from "./api/websocket.js";

export function createApp(db: FairygitMotherDb) {
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

	// Real-time feed (WebSocket upgrade — plain HTTP gets 426)
	app.get("/api/v1/feed", feedRouteHandler);

	// API routes
	app.route("/api/v1/nodes", createNodeRoutes(db));
	app.route("/api/v1/bounties", createBountyRoutes(db));
	app.route("/api/v1/reviews", createReviewRoutes(db));
	app.route("/api/v1/stats", createStatsRoutes(db));

	// Dashboard
	app.route("/", createDashboardRoutes(db));

	return app;
}
