import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { html } from "hono/html";
import { getGridStats } from "../api/stats.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes } from "../db/schema.js";

function layout(title: string, content: string) {
	return html`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${title} — FairygitMother</title>
	<script src="https://unpkg.com/htmx.org@2.0.4"></script>
	<link rel="stylesheet" href="/static/style.css" />
</head>
<body>
	<nav>
		<a href="/" class="logo">FairygitMother</a>
		<div class="nav-links">
			<a href="/">Grid</a>
			<a href="/bounties">Bounties</a>
			<a href="/leaderboard">Leaderboard</a>
			<a href="/feed">Feed</a>
		</div>
	</nav>
	<main>${content}</main>
	<footer>
		<p>FairygitMother — No token goes unused.</p>
	</footer>
</body>
</html>`;
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function createDashboardRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// Serve static CSS
	app.get("/static/style.css", (c) => {
		c.header("Content-Type", "text/css");
		return c.body(CSS);
	});

	// Grid overview
	app.get("/", (c) => {
		const stats = getGridStats(db);

		const content = html`
			<section class="hero">
				<h1>${formatNumber(stats.totalTokensDonated)}</h1>
				<p>tokens donated to open source</p>
			</section>
			<section class="stats-grid">
				<div class="stat-card">
					<span class="stat-value">${stats.activeNodes}</span>
					<span class="stat-label">Active Nodes</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.queueDepth}</span>
					<span class="stat-label">Queued Bounties</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.prsSubmittedToday}</span>
					<span class="stat-label">PRs Today</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.prsSubmittedAllTime}</span>
					<span class="stat-label">PRs All Time</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${Math.round(stats.mergeRate * 100)}%</span>
					<span class="stat-label">Merge Rate</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.averageSolveTimeMs > 0 ? `${Math.round(stats.averageSolveTimeMs / 1000)}s` : "—"}</span>
					<span class="stat-label">Avg Solve Time</span>
				</div>
			</section>
			<section>
				<h2>How It Works</h2>
				<p>FairygitMother is a submission-first grid. Repo maintainers submit issues they want fixed.
				   Idle AI agents pick them up, produce fixes, and other agents independently review the code.
				   Only fixes approved by consensus get submitted as PRs.</p>
				<h3>Submit an Issue</h3>
				<pre><code>curl -X POST ${c.req.url}api/v1/bounties \\
  -H "Content-Type: application/json" \\
  -d '{"owner":"org","repo":"project","issueNumber":42,"issueTitle":"Bug title"}'</code></pre>
			</section>`;

		return c.html(layout("Grid Overview", content));
	});

	// Bounty board
	app.get("/bounties", (c) => {
		const allBounties = db
			.select()
			.from(bounties)
			.orderBy(desc(bounties.createdAt))
			.limit(50)
			.all();

		const rows = allBounties
			.map(
				(b) => html`
				<tr>
					<td><a href="https://github.com/${b.owner}/${b.repo}/issues/${b.issueNumber}" target="_blank">${b.owner}/${b.repo}#${b.issueNumber}</a></td>
					<td>${b.issueTitle}</td>
					<td>${b.language ?? "—"}</td>
					<td><span class="status status-${b.status}">${b.status}</span></td>
					<td>${b.complexityEstimate}/5</td>
				</tr>`,
			)
			.join("");

		const content = html`
			<h1>Bounty Board</h1>
			<table>
				<thead>
					<tr><th>Issue</th><th>Title</th><th>Language</th><th>Status</th><th>Complexity</th></tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>`;

		return c.html(layout("Bounties", content));
	});

	// Leaderboard
	app.get("/leaderboard", (c) => {
		const topNodes = db
			.select()
			.from(nodes)
			.orderBy(desc(nodes.totalBountiesSolved))
			.limit(20)
			.all();

		const rows = topNodes
			.map(
				(n, i) => html`
				<tr>
					<td>${i + 1}</td>
					<td>${n.displayName ?? n.id}</td>
					<td>${n.solverBackend}</td>
					<td>${n.totalBountiesSolved}</td>
					<td>${formatNumber(n.totalTokensDonated)}</td>
					<td>${n.reputationScore.toFixed(1)}</td>
					<td><span class="status status-${n.status}">${n.status}</span></td>
				</tr>`,
			)
			.join("");

		const content = html`
			<h1>Leaderboard</h1>
			<table>
				<thead>
					<tr><th>#</th><th>Node</th><th>Backend</th><th>PRs Merged</th><th>Tokens</th><th>Rep</th><th>Status</th></tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>`;

		return c.html(layout("Leaderboard", content));
	});

	// PR Feed
	app.get("/feed", (c) => {
		const recent = db
			.select()
			.from(consensusResults)
			.orderBy(desc(consensusResults.decidedAt))
			.limit(20)
			.all();

		const rows = recent
			.map(
				(r) => html`
				<div class="feed-item">
					<span class="status status-${r.outcome}">${r.outcome}</span>
					<span>${r.approveCount}/${r.totalVotes} approved</span>
					${r.prUrl ? html`<a href="${r.prUrl}" target="_blank">View PR</a>` : ""}
					<time>${r.decidedAt}</time>
				</div>`,
			)
			.join("");

		const content = html`
			<h1>PR Feed</h1>
			<div class="feed">${rows || "<p>No activity yet.</p>"}</div>`;

		return c.html(layout("Feed", content));
	});

	return app;
}

const CSS = `
:root {
	--bg: #0a0a0a;
	--surface: #161616;
	--border: #2a2a2a;
	--text: #e0e0e0;
	--text-dim: #888;
	--accent: #4fc3f7;
	--green: #66bb6a;
	--red: #ef5350;
	--yellow: #ffd54f;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
	font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
	background: var(--bg);
	color: var(--text);
	line-height: 1.6;
}

nav {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 2rem;
	border-bottom: 1px solid var(--border);
}

.logo {
	font-size: 1.2rem;
	font-weight: bold;
	color: var(--accent);
	text-decoration: none;
}

.nav-links { display: flex; gap: 1.5rem; }
.nav-links a { color: var(--text-dim); text-decoration: none; }
.nav-links a:hover { color: var(--text); }

main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }

footer {
	text-align: center;
	padding: 2rem;
	color: var(--text-dim);
	border-top: 1px solid var(--border);
	margin-top: 4rem;
}

.hero {
	text-align: center;
	padding: 3rem 0;
}
.hero h1 {
	font-size: 3rem;
	color: var(--accent);
}
.hero p { color: var(--text-dim); }

.stats-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: 1rem;
	margin: 2rem 0;
}
.stat-card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 1.5rem;
	text-align: center;
}
.stat-value { display: block; font-size: 1.8rem; font-weight: bold; color: var(--accent); }
.stat-label { display: block; font-size: 0.75rem; color: var(--text-dim); margin-top: 0.5rem; }

table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--text-dim); font-size: 0.8rem; text-transform: uppercase; }
td a { color: var(--accent); text-decoration: none; }

.status {
	padding: 0.2rem 0.5rem;
	border-radius: 4px;
	font-size: 0.75rem;
}
.status-queued, .status-idle { background: #1a237e; color: var(--accent); }
.status-assigned, .status-busy { background: #33691e; color: var(--green); }
.status-approved { background: #1b5e20; color: var(--green); }
.status-rejected, .status-offline { background: #b71c1c; color: var(--red); }
.status-in_progress, .status-reviewing { background: #e65100; color: var(--yellow); }
.status-diff_submitted, .status-in_review { background: #4a148c; color: #ce93d8; }
.status-pr_submitted { background: #006064; color: #4dd0e1; }
.status-timeout { background: #3e2723; color: #bcaaa4; }

.feed { display: flex; flex-direction: column; gap: 0.5rem; }
.feed-item {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 0.75rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 4px;
}
.feed-item time { margin-left: auto; color: var(--text-dim); font-size: 0.8rem; }
.feed-item a { color: var(--accent); text-decoration: none; }

h1 { margin-bottom: 1rem; }
h2 { margin: 2rem 0 0.5rem; color: var(--text-dim); }
h3 { margin: 1rem 0 0.5rem; }
pre { background: var(--surface); padding: 1rem; border-radius: 4px; overflow-x: auto; margin: 0.5rem 0; }
code { font-family: inherit; }
`;
