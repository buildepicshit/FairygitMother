import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

export async function runMigrations(connectionString: string, migrationsDir: string) {
	const sql = postgres(connectionString, { max: 1 });

	await sql`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	const rows = await sql`SELECT MAX(version) as v FROM schema_version`;
	const version = rows[0]?.v ?? 0;

	const migrationFile = join(migrationsDir, "0002_postgres.sql");
	if (version < 2) {
		const sqlContent = readFileSync(migrationFile, "utf-8");
		await sql.unsafe(sqlContent);
		await sql`INSERT INTO schema_version (version) VALUES (2)`;
	}

	await sql.end();
}
