import { createMiddleware } from "hono/factory";
import type { FairygitMotherDb } from "../db/client.js";
import { findNodeByApiKey } from "../orchestrator/registry.js";

/**
 * Paths that skip authentication.
 * Matched against the full request pathname.
 */
const PUBLIC_PATHS = new Set([
	"/api/v1/nodes/register",
	"/api/v1/health",
	"/api/v1/stats",
	"/api/v1/feed",
	"/api/v1/bounties",
	"/api/v1/bounties/claim",
	"/api/v1/admin/reset",
	"/api/v1/admin/close-pr",
]);

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_PATHS.has(pathname)) return true;
	// Submissions endpoint is public (GET /api/v1/bounties/:id/submissions)
	if (/^\/api\/v1\/bounties\/[^/]+\/submissions$/.test(pathname)) return true;
	// Non-API routes (dashboard, static assets) don't require auth
	if (!pathname.startsWith("/api/")) return true;
	return false;
}

export function authMiddleware(db: FairygitMotherDb) {
	return createMiddleware(async (c, next) => {
		const path = new URL(c.req.url).pathname;

		if (isPublicPath(path)) {
			return next();
		}

		const authHeader = c.req.header("Authorization");
		if (!authHeader) {
			return c.json({ error: "Missing Authorization header" }, 401);
		}

		const match = authHeader.match(/^Bearer\s+(.+)$/i);
		if (!match) {
			return c.json({ error: "Invalid Authorization header format" }, 401);
		}

		const apiKey = match[1];
		const node = await findNodeByApiKey(db, apiKey);
		if (!node) {
			return c.json({ error: "Invalid API key" }, 401);
		}

		c.set("nodeId", node.id);
		return next();
	});
}
