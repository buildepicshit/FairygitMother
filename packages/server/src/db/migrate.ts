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
		await applyMigration(client, migrationsDir, 1, "0001_initial_pg.sql");
	}

	if (version < 2) {
		await applyMigration(client, migrationsDir, 2, "0002_add_indexes_and_constraints.sql");
	}

	if (version < 3) {
		await applyMigration(
			client,
			migrationsDir,
			3,
			"0003_consensus_unique_and_submission_limit.sql",
		);
	}

	if (version < 4) {
		await applyMigration(client, migrationsDir, 4, "0004_add_rejection_reasons.sql");
	}

	await client.end();
}

async function applyMigration(
	client: pg.Client,
	migrationsDir: string,
	version: number,
	filename: string,
) {
	const migrationFile = join(migrationsDir, filename);
	const sql = readFileSync(migrationFile, "utf-8");

	await client.query("BEGIN");
	try {
		await client.query(sql);
		await client.query("INSERT INTO schema_version (version) VALUES ($1)", [version]);
		await client.query("COMMIT");
		console.log(`[migrations] Applied PostgreSQL migration ${filename}`);
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	}
}
