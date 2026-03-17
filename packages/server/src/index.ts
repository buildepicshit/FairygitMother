import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubAppClient, createGitHubClient, loadConfig } from "@fairygitmother/core";
import { serve } from "@hono/node-server";
import { attachNodeWebSocketHandler } from "./api/node-push.js";
import { setStatsBaseline } from "./api/stats.js";
import { attachWebSocketHandler } from "./api/websocket.js";
import { createApp } from "./app.js";
import type { PrSubmitContext } from "./consensus/aggregator.js";
import { cleanupMergedPrs } from "./consensus/cleanup.js";
import { closeDb, getDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { requeueStaleBounties, requeueStaleDiffs } from "./orchestrator/queue.js";
import { pruneStaleNodes } from "./orchestrator/registry.js";
import { scheduleTask, stopAll } from "./orchestrator/scheduler.js";
import { loadPersistedStats, savePersistedStats } from "./stats-persistence.js";

const config = loadConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../../../migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[fairygitmother] FATAL: DATABASE_URL environment variable is required.");
	process.exit(1);
}

await runMigrations(databaseUrl, migrationsDir);
const db = getDb(databaseUrl);
console.log("[fairygitmother] Using PostgreSQL");

// Load persisted stats
const statsPath = resolve(dirname(config.dbPath), "persisted-stats.json");
let persistedStats = loadPersistedStats(statsPath);
setStatsBaseline(persistedStats);

// Set up PR auto-submit context if configured
let prContext: PrSubmitContext | undefined;
if (config.autoSubmitPrs && config.forkOwner) {
	let github: import("@fairygitmother/core").GitHubClient | undefined;
	if (config.githubAppId && config.githubAppPrivateKey && config.githubAppInstallationId) {
		github = await createGitHubAppClient({
			appId: config.githubAppId,
			privateKey: config.githubAppPrivateKey,
			installationId: config.githubAppInstallationId,
		});
		console.log(
			`[fairygitmother] PR auto-submit enabled via GitHub App (fork owner: ${config.forkOwner})`,
		);
	} else if (config.githubToken) {
		github = createGitHubClient(config.githubToken);
		console.log(
			`[fairygitmother] PR auto-submit enabled via token (fork owner: ${config.forkOwner})`,
		);
	}
	if (github) {
		prContext = { github, forkOwner: config.forkOwner };
	}
}
if (!prContext) {
	console.log(
		"[fairygitmother] PR auto-submit disabled (set FAIRYGITMOTHER_AUTO_SUBMIT_PRS=true + auth)",
	);
}

const app = createApp(db, prContext);

// Schedule background tasks
scheduleTask(
	"prune-stale-nodes",
	async () => {
		const pruned = await pruneStaleNodes(db, config.nodeTimeoutMs);
		if (pruned > 0) console.log(`[scheduler] Pruned ${pruned} stale nodes`);
	},
	60_000,
);

// Requeue bounties stuck in "assigned" for >10 minutes (agent went silent)
scheduleTask(
	"requeue-stale-bounties",
	async () => {
		const requeued = await requeueStaleBounties(db, 10 * 60_000);
		if (requeued > 0) console.log(`[scheduler] Requeued ${requeued} stale assigned bounties`);
	},
	120_000,
);

// Requeue bounties stuck in "diff_submitted" for >30 minutes (no reviewers available)
scheduleTask(
	"requeue-stale-diffs",
	async () => {
		const requeued = await requeueStaleDiffs(db, 30 * 60_000);
		if (requeued > 0) console.log(`[scheduler] Requeued ${requeued} stale diff_submitted bounties`);
	},
	300_000,
);

// Clean up merged/closed PRs and delete fork branches every 10 minutes
if (prContext) {
	const { github: prGitHub, forkOwner } = prContext;
	scheduleTask(
		"cleanup-merged-prs",
		async () => {
			const { merged, closed } = await cleanupMergedPrs(db, prGitHub, forkOwner);
			if (merged + closed > 0) {
				console.log(`[scheduler] PR cleanup: ${merged} merged, ${closed} closed`);
			}
		},
		600_000,
	);
}

// Persist stats every 5 minutes (survives deploys)
scheduleTask(
	"persist-stats",
	async () => {
		persistedStats = await savePersistedStats(statsPath, db, persistedStats);
		setStatsBaseline(persistedStats);
	},
	300_000,
);

// Start server
const _server = serve({
	fetch: app.fetch,
	port: config.port,
	hostname: config.host,
});

// Attach WebSocket handlers to the underlying HTTP server
attachWebSocketHandler(_server);
attachNodeWebSocketHandler(_server, db);

console.log(`[fairygitmother] Server running on http://${config.host}:${config.port}`);

// Graceful shutdown
async function shutdown(signal: string) {
	console.log(`\n[fairygitmother] ${signal} received, shutting down...`);
	await savePersistedStats(statsPath, db, persistedStats);
	stopAll();
	closeDb();
	process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
