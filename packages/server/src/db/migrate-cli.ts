import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[migrate-cli] DATABASE_URL is required.");
	process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "../../../../migrations");

await runMigrations(databaseUrl, migrationsDir);
console.log("[migrate-cli] Migrations complete.");
