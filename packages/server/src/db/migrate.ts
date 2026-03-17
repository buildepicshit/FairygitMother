import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

export function runMigrations(dbPath: string, migrationsDir: string) {
	const db = new Database(dbPath);
	db.pragma("journal_mode = DELETE");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");

	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const currentVersion = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as
		| { v: number | null }
		| undefined;
	const version = currentVersion?.v ?? 0;

	// Read migration files in order
	const migrationFile = join(migrationsDir, "0001_initial.sql");
	if (version < 1) {
		const sql = readFileSync(migrationFile, "utf-8");
		db.exec(sql);
		db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
	}

	db.close();
}

export async function runPgMigrations(connectionString: string, migrationsDir: string) {
	const client = new pg.Client({
		connectionString,
		ssl: { rejectUnauthorized: false },
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

	await client.end();
}
