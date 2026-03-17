import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export async function runMigrations(connectionString: string, migrationsDir: string) {
	const client = new pg.Client({
		connectionString,
		ssl: connectionString.includes("azure") ? { rejectUnauthorized: false } : undefined,
	});
	await client.connect();

	await client.query(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
		)
	`);

	const result = await client.query("SELECT MAX(version) as v FROM schema_version");
	const version = result.rows[0]?.v ?? 0;

	if (version < 1) {
		const migrationFile = join(migrationsDir, "0001_initial_pg.sql");
		const sql = readFileSync(migrationFile, "utf-8");
		await client.query(sql);
		await client.query("INSERT INTO schema_version (version) VALUES ($1)", [1]);
		console.log("[migrations] Applied PostgreSQL migration 0001_initial_pg.sql");
	}

	if (version < 2) {
		const migrationFile = join(migrationsDir, "0002_add_indexes_and_constraints.sql");
		const sql = readFileSync(migrationFile, "utf-8");
		await client.query(sql);
		await client.query("INSERT INTO schema_version (version) VALUES ($1)", [2]);
		console.log("[migrations] Applied PostgreSQL migration 0002_add_indexes_and_constraints.sql");
	}

	await client.end();
}
