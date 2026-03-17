/**
 * Seeds additional bounties from the exhaustive failure analysis.
 * All scoped as small, atomic, agent-solvable tasks.
 */

const BASE = process.env.ORCHESTRATOR_URL ?? "https://fairygitmother.ai";

const issues = [
	{
		issueNumber: 109,
		issueTitle: "Add WS ping/pong keepalive to detect stale node connections",
		issueBody:
			"packages/server/src/api/node-push.ts — No ping/pong on node WebSocket connections. If TCP silently dies, the server keeps pushing to a dead socket. Add server-side ping every 30s, close connection if no pong within 10s.",
		labels: ["reliability", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 110,
		issueTitle: "Add exponential backoff to client WebSocket reconnect",
		issueBody:
			"packages/node/src/client.ts:156-161 — scheduleReconnect uses fixed 5s interval. If server is down for hours, this hammers it with reconnect attempts every 5s forever. Change to exponential backoff: 5s → 10s → 20s → 60s cap.",
		labels: ["reliability", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 111,
		issueTitle: "Add connectionTimeoutMillis to pg Pool config",
		issueBody:
			"packages/server/src/db/client.ts:12-16 — pg.Pool has no connectionTimeoutMillis set. Under pool exhaustion, requests block indefinitely. Add connectionTimeoutMillis: 10000 to the pool config.",
		labels: ["reliability", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 112,
		issueTitle: "Add maxRetries cap to bounty requeue cycle",
		issueBody:
			"packages/server/src/orchestrator/queue.ts — requeue() has no cap on retryCount. A bounty can cycle queued→assigned→queued forever. Add a MAX_RETRIES (e.g. 5) check in requeue(). If exceeded, set status to 'failed' instead of 'queued'.",
		labels: ["reliability", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 113,
		issueTitle: "Block votes on already-decided bounties",
		issueBody:
			"packages/server/src/api/reviews.ts — Votes are still accepted after a bounty reaches consensus (approved/rejected). The vote gets recorded and reviewer reputation is applied even though the decision is final. Add a check: if bounty status is approved/rejected/pr_submitted, return 409.",
		labels: ["correctness", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 114,
		issueTitle: "Add periodic cleanup for expired rate limiter windows",
		issueBody:
			"packages/server/src/middleware/ratelimit.ts — The windows Map is never pruned. Over time it accumulates entries for every unique caller. Add a cleanup sweep every 5 minutes that deletes entries where (now - windowStart) > windowMs.",
		labels: ["memory-leak", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 115,
		issueTitle: "Handle existing branch/PR in submitPr to recover from partial failures",
		issueBody:
			"packages/server/src/consensus/submitter.ts — If submitPr crashes after creating the branch but before creating the PR, the next retry fails with 422 (branch exists). Detect the 422 from createRefOnRepo, check if a PR already exists for this branch, and reuse it if so.",
		labels: ["reliability"],
		language: "TypeScript",
		complexity: 2,
	},
	{
		issueNumber: 116,
		issueTitle: "Add overlap guard to scheduler to prevent concurrent task runs",
		issueBody:
			"packages/server/src/orchestrator/scheduler.ts — If a scheduled task takes longer than its interval, setInterval fires again while the first is still running. Add a 'running' flag per task that skips execution if the previous run hasn't finished.",
		labels: ["reliability", "good first issue"],
		language: "TypeScript",
		complexity: 1,
	},
];

async function main() {
	console.log(`Seeding reliability bounties to ${BASE}...\n`);

	for (const issue of issues) {
		const res = await fetch(`${BASE}/api/v1/bounties`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: "buildepicshit",
				repo: "FairygitMother",
				issueNumber: issue.issueNumber,
				issueTitle: issue.issueTitle,
				issueBody: issue.issueBody,
				labels: issue.labels,
				language: issue.language,
				complexityEstimate: issue.complexity,
			}),
		});

		const data = await res.json();
		if (res.status === 201) {
			console.log(`  C${issue.complexity} #${issue.issueNumber}: ${issue.issueTitle}`);
		} else if (res.status === 409) {
			console.log(`  SKIP #${issue.issueNumber}: already exists`);
		} else {
			console.log(`  FAIL #${issue.issueNumber}: ${res.status} ${JSON.stringify(data)}`);
		}
	}

	const stats = await (await fetch(`${BASE}/api/v1/stats`)).json();
	console.log(`\nBounty board: ${stats.queueDepth} queued`);
}

main().catch(console.error);
