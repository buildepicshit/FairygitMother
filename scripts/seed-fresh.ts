/**
 * Fresh bounty load — only issues that are still open.
 * Server auto-enriches each with fileContext from GitHub API.
 */

const BASE = process.env.ORCHESTRATOR_URL ?? "https://fairygitmother.ai";

const issues = [
	{
		n: 201,
		title: "Type client.fetch() return as generic instead of any",
		body: "packages/node/src/client.ts line 164 — `private async fetch(path: string, method: string, body?: unknown): Promise<any>`. Make it generic: `fetch<T>(...): Promise<T>` and type each call site (register, heartbeat, claimBounty, submitFix, submitVote, getStats, disconnect).",
		labels: ["type-safety"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 202,
		title: "Replace (err as any) with NodeJS.ErrnoException in containerExec",
		body: "packages/node/src/sandbox.ts lines 356-360 — `(err as any).code` and `(err as any).killed` should use `(err as NodeJS.ErrnoException)`. The fields exist on the actual runtime type.",
		labels: ["type-safety"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 203,
		title: "Cache getRepoLanguages per repo in trawler scan loop",
		body: "packages/server/src/orchestrator/trawler.ts — `getRepoLanguages` is called inside a per-issue loop. If a repo has 20 issues, that's 20 identical API calls. Add a `Map<string, Record<string,number>>` cache keyed by `owner/repo` for the duration of the scan.",
		labels: ["performance"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 204,
		title: "Remove unused nodeId from claimBounty request body",
		body: "packages/node/src/client.ts line 51 — `claimBounty()` sends `{ nodeId: this.nodeId }` but the server reads `body.apiKey`, not `body.nodeId`. Remove the nodeId field. Send `{ apiKey: this.apiKey }` instead to match the API contract.",
		labels: ["cleanup"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 205,
		title: "Add WS ping/pong keepalive to detect stale node connections",
		body: "packages/server/src/api/node-push.ts — No ping/pong on node WebSocket connections. If TCP silently dies, server pushes to dead socket. Add server-side `ws.ping()` every 30s in the connection handler. On pong timeout (10s), close the connection and remove from connectedNodes map.",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 206,
		title: "Add exponential backoff to client WebSocket reconnect",
		body: "packages/node/src/client.ts lines 156-162 — `scheduleReconnect` uses fixed 5s. Change to exponential backoff: 5s → 10s → 20s → 40s → 60s cap. Reset backoff on successful connection (in `onopen` handler).",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 207,
		title: "Add maxRetries cap to bounty requeue cycle",
		body: "packages/server/src/orchestrator/queue.ts — `requeue()` has no cap on `retryCount`. A bounty can cycle queued→assigned→queued forever. Add `const MAX_RETRIES = 5`. In `requeue()`, if `bounty.retryCount >= MAX_RETRIES`, set status to `failed` instead of `queued`.",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 208,
		title: "Block votes on already-decided bounties",
		body: "packages/server/src/api/reviews.ts — After fetching the bounty (line 53-55), check `if (['approved','rejected','pr_submitted','pr_merged','pr_closed'].includes(bounty.status))` and return 409 'Bounty already decided'. Currently votes are accepted and reputation applied even after consensus.",
		labels: ["correctness"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 209,
		title: "Add overlap guard to scheduler — prevent concurrent task runs",
		body: "packages/server/src/orchestrator/scheduler.ts — Add `running?: boolean` to the ScheduledTask interface (line 3-8). In the setInterval callback (line 17-23), check `if (scheduled.running) return` before the try block, set `scheduled.running = true`, and set it back to false in a finally block.",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 210,
		title: "Add periodic cleanup for expired rate limiter windows",
		body: "packages/server/src/middleware/ratelimit.ts — The `windows` Map (line 46) is never pruned. Add a `setInterval` in `createRateLimiter` that runs every 5 minutes and deletes entries where `(Date.now() - entry.windowStart) > windowMs`.",
		labels: ["memory-leak"],
		lang: "TypeScript",
		c: 1,
	},
	{
		n: 211,
		title: "Handle existing branch in submitPr to recover from partial failures",
		body: "packages/server/src/consensus/submitter.ts line 107 — `createRefOnRepo` throws 422 if the branch already exists (from a prior failed run). Wrap in try/catch: on 422, check if a PR already exists for this branch via GitHub API. If yes, use its URL. If no, force-push the branch.",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 2,
	},
	{
		n: 212,
		title: "Add connectionTimeoutMillis to pg Pool config",
		body: "packages/server/src/db/client.ts line 12-16 — The pg.Pool constructor has no connectionTimeoutMillis. Under pool exhaustion, requests block indefinitely. Add `connectionTimeoutMillis: 10_000` after `max: 10,` at line 15.",
		labels: ["reliability"],
		lang: "TypeScript",
		c: 1,
	},
];

async function main() {
	console.log(`Seeding ${issues.length} fresh bounties to ${BASE}...\n`);

	for (const issue of issues) {
		const res = await fetch(`${BASE}/api/v1/bounties`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: "buildepicshit",
				repo: "FairygitMother",
				issueNumber: issue.n,
				issueTitle: issue.title,
				issueBody: issue.body,
				labels: issue.labels,
				language: issue.lang,
				complexityEstimate: issue.c,
			}),
		});

		const data = (await res.json()) as Record<string, unknown>;
		if (res.status === 201) {
			console.log(`  C${issue.c} #${issue.n}: ${issue.title}`);
		} else {
			console.log(`  FAIL #${issue.n}: ${res.status} ${JSON.stringify(data)}`);
		}

		// Small delay to let enrichment fire between bounties
		await new Promise((r) => setTimeout(r, 500));
	}

	// Wait for enrichment to complete
	console.log("\nWaiting 10s for file context enrichment...");
	await new Promise((r) => setTimeout(r, 10_000));

	const stats = (await (await fetch(`${BASE}/api/v1/stats`)).json()) as Record<string, unknown>;
	console.log(`\nBounty board: ${stats.queueDepth} queued`);

	// Check enrichment
	const bounties = (await (await fetch(`${BASE}/api/v1/bounties?limit=20`)).json()) as {
		bounties: Array<{ issueNumber: number; fileContext: unknown }>;
	};
	const enriched = bounties.bounties.filter((b) => b.fileContext).length;
	console.log(`Enriched with file context: ${enriched}/${bounties.bounties.length}`);
}

main().catch(console.error);
