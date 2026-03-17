/**
 * Seeds the bounty board with dogfood issues — real improvements
 * to FairygitMother itself, scoped as small atomic C1/C2 tasks.
 *
 * Usage: ORCHESTRATOR_URL=https://fairygitmother.ai npx tsx scripts/seed-dogfood.ts
 */

const BASE = process.env.ORCHESTRATOR_URL ?? "https://fairygitmother.ai";

const issues = [
	{
		issueNumber: 101,
		issueTitle: "Type client.fetch() return as generic instead of any",
		issueBody:
			"packages/node/src/client.ts:159 — `private async fetch(...): Promise<any>`. The core network method returns `any`, defeating strict mode for the entire client. Fix: make it generic `fetch<T>(...): Promise<T>` and type each call site.",
		labels: ["good first issue", "type-safety"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 102,
		issueTitle: "Replace `as any` with NodeJS.ErrnoException in containerExec",
		issueBody:
			"packages/node/src/sandbox.ts:372-376 — `(err as any).code` and `(err as any).killed` should use `(err as NodeJS.ErrnoException).code` and `.killed`. These fields exist on the actual runtime type.",
		labels: ["good first issue", "type-safety"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 103,
		issueTitle: "Cache getRepoLanguages per repo in trawler to avoid N+1 API calls",
		issueBody:
			"packages/server/src/orchestrator/trawler.ts:37-40 — For every eligible issue, `getRepoLanguages` is called. If a repo has 20 issues, that's 20 identical API calls. Cache the result per `owner/repo` for the duration of the scan.",
		labels: ["good first issue", "performance"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 104,
		issueTitle: "Remove unused nodeId from claimBounty request body",
		issueBody:
			"packages/node/src/client.ts:46 — `claimBounty()` sends `{ nodeId: this.nodeId }` but the server reads `body.apiKey`, not `body.nodeId`. The nodeId field is silently ignored. Remove it to match the actual API contract.",
		labels: ["good first issue", "cleanup"],
		language: "TypeScript",
		complexity: 1,
	},
	{
		issueNumber: 105,
		issueTitle: "Add tests for requeueStaleBounties and requeueStaleDiffs",
		issueBody:
			"tests/server/orchestrator/queue.test.ts — The two background scheduler functions `requeueStaleBounties` and `requeueStaleDiffs` have no test coverage. They run every 2-5 minutes in production and silently reset bounty state. Add tests that insert bounties with old timestamps and verify they get requeued.",
		labels: ["good first issue", "test-coverage"],
		language: "TypeScript",
		complexity: 2,
	},
	{
		issueNumber: 106,
		issueTitle: "Extract dashboard CSS into a separate static file",
		issueBody:
			"packages/server/src/dashboard/views.tsx — The 800+ line CSS string is embedded as a template literal at the bottom of the file. Extract it to a separate `.css` file served from `/static/style.css` (the HTML already references this path). The file currently serves the CSS inline from a route handler.",
		labels: ["good first issue", "cleanup"],
		language: "TypeScript",
		complexity: 2,
	},
	{
		issueNumber: 107,
		issueTitle: "Narrow secret pattern regex to reduce false positives in diff safety scanner",
		issueBody:
			"packages/server/src/orchestrator/governor.ts:9 — The pattern `/(?:password|secret|api_key|token)\\s*[:=]\\s*['\"][^'\"]+['\"]/i` blocks any diff touching `const secretMessage = \"hello\"` or `const tokenizer = \"...\"`. Tighten to require the matched word to be a standalone identifier (word boundary) and the value to look like a credential (min length, entropy check, or known prefixes like sk-, ghp_, etc.).",
		labels: ["good first issue", "bug"],
		language: "TypeScript",
		complexity: 2,
	},
	{
		issueNumber: 108,
		issueTitle: "Add WebSocket push test for work_available and review_available notifications",
		issueBody:
			"The node-push.ts module (pushToIdleNodes, pushToNode, updateNodeStatus) has no test coverage. Add unit tests that verify: idle nodes receive work_available when a bounty is created, idle nodes receive review_available when a fix is submitted (excluding the solver), busy nodes don't receive notifications.",
		labels: ["good first issue", "test-coverage"],
		language: "TypeScript",
		complexity: 2,
	},
];

async function main() {
	console.log(`Seeding dogfood bounties to ${BASE}...\n`);

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
