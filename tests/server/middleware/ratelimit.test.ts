import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
	createRateLimiter,
	type RateLimitMiddleware,
} from "@fairygitmother/server/middleware/ratelimit.js";

function createTestApp(opts: { windowMs?: number; maxRequests?: number } = {}) {
	const app = new Hono();
	const limiter = createRateLimiter(opts);

	app.use("/api/*", limiter);

	// Health endpoint (exempt)
	app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

	// Generic API endpoint for testing
	app.get("/api/v1/test", (c) => c.json({ ok: true }));
	app.post("/api/v1/test", (c) => c.json({ ok: true }));

	return { app, limiter: limiter as RateLimitMiddleware };
}

function makeRequest(
	app: Hono,
	path: string,
	opts: { apiKey?: string; method?: string } = {},
) {
	const headers: Record<string, string> = {};
	if (opts.apiKey) {
		headers["Authorization"] = `Bearer ${opts.apiKey}`;
	}
	return app.request(path, { method: opts.method ?? "GET", headers });
}

describe("rate limiter middleware", () => {
	describe("requests within limit", () => {
		it("allows requests under the limit", async () => {
			const { app } = createTestApp({ maxRequests: 5, windowMs: 60_000 });

			for (let i = 0; i < 5; i++) {
				const res = await makeRequest(app, "/api/v1/test", {
					apiKey: "mf_test_key",
				});
				expect(res.status).toBe(200);
			}
		});

		it("allows exactly maxRequests before rejecting", async () => {
			const { app } = createTestApp({ maxRequests: 3, windowMs: 60_000 });

			for (let i = 0; i < 3; i++) {
				const res = await makeRequest(app, "/api/v1/test", {
					apiKey: "mf_exact",
				});
				expect(res.status).toBe(200);
			}

			const rejected = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_exact",
			});
			expect(rejected.status).toBe(429);
		});
	});

	describe("requests over limit", () => {
		it("returns 429 with Retry-After header", async () => {
			const { app } = createTestApp({ maxRequests: 2, windowMs: 60_000 });

			// Exhaust the limit
			await makeRequest(app, "/api/v1/test", { apiKey: "mf_over" });
			await makeRequest(app, "/api/v1/test", { apiKey: "mf_over" });

			const res = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_over",
			});
			expect(res.status).toBe(429);

			const body = await res.json();
			expect(body.error).toBe("Too Many Requests");
			expect(body.retryAfter).toBeGreaterThan(0);

			const retryAfter = res.headers.get("Retry-After");
			expect(retryAfter).toBeTruthy();
			expect(Number(retryAfter)).toBeGreaterThan(0);
		});

		it("continues rejecting until window resets", async () => {
			const { app } = createTestApp({ maxRequests: 1, windowMs: 60_000 });

			await makeRequest(app, "/api/v1/test", { apiKey: "mf_reject" });

			for (let i = 0; i < 3; i++) {
				const res = await makeRequest(app, "/api/v1/test", {
					apiKey: "mf_reject",
				});
				expect(res.status).toBe(429);
			}
		});
	});

	describe("independent limits per key", () => {
		it("tracks different API keys independently", async () => {
			const { app } = createTestApp({ maxRequests: 2, windowMs: 60_000 });

			// Exhaust key A
			await makeRequest(app, "/api/v1/test", { apiKey: "mf_key_a" });
			await makeRequest(app, "/api/v1/test", { apiKey: "mf_key_a" });
			const rejectedA = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_key_a",
			});
			expect(rejectedA.status).toBe(429);

			// Key B should still work
			const resB = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_key_b",
			});
			expect(resB.status).toBe(200);
		});

		it("tracks unauthenticated requests by IP separately from keyed requests", async () => {
			const { app } = createTestApp({ maxRequests: 1, windowMs: 60_000 });

			// Unauthenticated request (keyed by IP)
			const res1 = await makeRequest(app, "/api/v1/test");
			expect(res1.status).toBe(200);

			// Authenticated request (keyed by API key) — independent
			const res2 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_keyed",
			});
			expect(res2.status).toBe(200);
		});
	});

	describe("window reset", () => {
		it("resets count after window expires", async () => {
			const { app, limiter } = createTestApp({
				maxRequests: 1,
				windowMs: 100,
			});

			// Use up the limit
			const res1 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_reset",
			});
			expect(res1.status).toBe(200);

			const res2 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_reset",
			});
			expect(res2.status).toBe(429);

			// Manually expire the window by backdating the entry
			const entry = limiter.__windows.get("key:mf_reset");
			expect(entry).toBeTruthy();
			entry!.windowStart = Date.now() - limiter.__windowMs - 1;

			// Should succeed again after window expires
			const res3 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_reset",
			});
			expect(res3.status).toBe(200);
		});
	});

	describe("health endpoint bypass", () => {
		it("does not rate limit GET /api/v1/health", async () => {
			const { app } = createTestApp({ maxRequests: 1, windowMs: 60_000 });

			// Exhaust the limit on a normal endpoint
			await makeRequest(app, "/api/v1/test", { apiKey: "mf_health" });
			const rejected = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_health",
			});
			expect(rejected.status).toBe(429);

			// Health endpoint should still work
			const healthRes = await makeRequest(app, "/api/v1/health", {
				apiKey: "mf_health",
			});
			expect(healthRes.status).toBe(200);
			const body = await healthRes.json();
			expect(body.status).toBe("ok");
		});

		it("health requests do not count toward the limit", async () => {
			const { app } = createTestApp({ maxRequests: 2, windowMs: 60_000 });

			// Make several health requests first
			for (let i = 0; i < 10; i++) {
				await makeRequest(app, "/api/v1/health", { apiKey: "mf_nocount" });
			}

			// Should still have full quota for regular endpoints
			const res1 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_nocount",
			});
			expect(res1.status).toBe(200);

			const res2 = await makeRequest(app, "/api/v1/test", {
				apiKey: "mf_nocount",
			});
			expect(res2.status).toBe(200);
		});
	});

	describe("factory defaults", () => {
		it("uses 60 requests per 60 seconds by default", () => {
			const limiter = createRateLimiter() as RateLimitMiddleware;
			expect(limiter.__maxRequests).toBe(60);
			expect(limiter.__windowMs).toBe(60_000);
		});

		it("accepts custom options", () => {
			const limiter = createRateLimiter({
				maxRequests: 100,
				windowMs: 30_000,
			}) as RateLimitMiddleware;
			expect(limiter.__maxRequests).toBe(100);
			expect(limiter.__windowMs).toBe(30_000);
		});
	});
});
