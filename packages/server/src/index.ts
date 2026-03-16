import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@fairygitmother/core";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { requeueStaleBounties, requeueStaleDiffs } from "./orchestrator/queue.js";
import { pruneStaleNodes } from "./orchestrator/registry.js";
import { scheduleTask, stopAll } from "./orchestrator/scheduler.js";

const config = loadConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../../../migrations");

// Run migrations
runMigrations(config.dbPath, migrationsDir);

// Initialize database and app
const db = getDb(config.dbPath);
const app = createApp(db);

// Schedule background tasks
scheduleTask(
	"prune-stale-nodes",
	async () => {
		const pruned = pruneStaleNodes(db, config.nodeTimeoutMs);
		if (pruned > 0) console.log(`[scheduler] Pruned ${pruned} stale nodes`);
	},
	60_000,
);

// Requeue bounties stuck in "assigned" for >10 minutes (agent went silent)
scheduleTask(
	"requeue-stale-bounties",
	async () => {
		const requeued = requeueStaleBounties(db, 10 * 60_000);
		if (requeued > 0) console.log(`[scheduler] Requeued ${requeued} stale assigned bounties`);
	},
	120_000,
);

// Requeue bounties stuck in "diff_submitted" for >30 minutes (no reviewers available)
scheduleTask(
	"requeue-stale-diffs",
	async () => {
		const requeued = requeueStaleDiffs(db, 30 * 60_000);
		if (requeued > 0) console.log(`[scheduler] Requeued ${requeued} stale diff_submitted bounties`);
	},
	300_000,
);

// Start server
const _server = serve({
	fetch: app.fetch,
	port: config.port,
	hostname: config.host,
});

console.log(`[fairygitmother] Server running on http://${config.host}:${config.port}`);

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n[fairygitmother] Shutting down...");
	stopAll();
	process.exit(0);
});
