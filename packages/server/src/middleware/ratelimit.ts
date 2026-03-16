import type { MiddlewareHandler } from "hono";

interface WindowEntry {
	count: number;
	windowStart: number;
}

interface RateLimiterOptions {
	windowMs: number;
	maxRequests: number;
}

const DEFAULT_OPTIONS: RateLimiterOptions = {
	windowMs: 60_000,
	maxRequests: 60,
};

/**
 * Extract the rate-limit key from a request.
 * Uses the Bearer token (API key) from the Authorization header when present,
 * otherwise falls back to the connecting IP address.
 */
function extractKey(c: Parameters<MiddlewareHandler>[0]): string {
	const auth = c.req.header("Authorization");
	if (auth?.startsWith("Bearer ")) {
		return `key:${auth.slice(7)}`;
	}
	// Hono exposes the remote address via c.env or the request header
	const forwarded = c.req.header("X-Forwarded-For");
	if (forwarded) {
		return `ip:${forwarded.split(",")[0].trim()}`;
	}
	return "ip:unknown";
}

/**
 * Creates a Hono middleware that enforces a sliding-window rate limit.
 *
 * Requests are keyed by API key (from the Authorization: Bearer header) or
 * by client IP for unauthenticated routes.
 *
 * The GET /api/v1/health endpoint is always exempt from rate limiting.
 */
export function createRateLimiter(opts: Partial<RateLimiterOptions> = {}): MiddlewareHandler {
	const { windowMs, maxRequests } = { ...DEFAULT_OPTIONS, ...opts };
	const windows = new Map<string, WindowEntry>();

	const middleware: MiddlewareHandler = async (c, next) => {
		// Skip rate limiting for the health endpoint
		if (c.req.method === "GET" && c.req.path === "/api/v1/health") {
			return next();
		}

		const key = extractKey(c);
		const now = Date.now();
		const entry = windows.get(key);

		if (!entry || now - entry.windowStart >= windowMs) {
			// Start a new window
			windows.set(key, { count: 1, windowStart: now });
			return next();
		}

		// Within current window
		if (entry.count >= maxRequests) {
			const retryAfterMs = windowMs - (now - entry.windowStart);
			const retryAfterSec = Math.ceil(retryAfterMs / 1000);

			c.header("Retry-After", String(retryAfterSec));
			return c.json(
				{
					error: "Too Many Requests",
					retryAfter: retryAfterSec,
				},
				429,
			);
		}

		entry.count++;
		return next();
	};

	// Expose internals for testing
	(middleware as RateLimitMiddleware).__windows = windows;
	(middleware as RateLimitMiddleware).__windowMs = windowMs;
	(middleware as RateLimitMiddleware).__maxRequests = maxRequests;

	return middleware;
}

/** Extended type exposing test-only internals. */
export interface RateLimitMiddleware extends MiddlewareHandler {
	__windows: Map<string, WindowEntry>;
	__windowMs: number;
	__maxRequests: number;
}
