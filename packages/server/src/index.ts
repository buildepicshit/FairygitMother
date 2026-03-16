import { serve } from "@hono/node-server";
import { loadConfig } from "@fairygitmother/core";
import { createApp } from "./app.js";
import { getDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { scheduleTask, stopAll } from "./orchestrator/scheduler.js";
import { pruneStaleNodes } from "./orchestrator/registry.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const config = loadConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../../../migrations");

// Run migrations
runMigrations(config.dbPath, migrationsDir);

// Initialize database and app
const db = getDb(config.dbPath);
const app = createApp(db);

// Schedule background tasks
scheduleTask("prune-stale-nodes", async () => {
	const pruned = pruneStaleNodes(db, config.nodeTimeoutMs);
	if (pruned > 0) console.log(`[scheduler] Pruned ${pruned} stale nodes`);
}, 60_000);

// Start server
const server = serve({
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
