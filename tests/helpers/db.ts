import * as schema from "@fairygitmother/server/db/schema.js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export type TestDb = ReturnType<typeof createTestDb>;

/**
 * Creates a test database connection from DATABASE_URL.
 * Throws immediately if DATABASE_URL is not set — prevents accidental
 * connection to production.
 */
export function createTestDb() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error(
			"DATABASE_URL must be set to run tests. " +
				"This is a safety check to prevent accidental connection to the production database.",
		);
	}
	const pool = new pg.Pool({
		connectionString: url,
		ssl: url.includes("azure") ? { rejectUnauthorized: false } : undefined,
		max: 5,
	});
	return drizzle(pool, { schema });
}

/**
 * Deletes all rows from all tables in FK-safe order.
 * Call this in beforeEach() for test isolation.
 */
export async function cleanAllTables(db: TestDb) {
	await db.delete(schema.auditLog);
	await db.delete(schema.consensusResults);
	await db.delete(schema.votes);
	await db.delete(schema.submissions);
	await db.delete(schema.bounties);
	await db.delete(schema.nodes);
	await db.delete(schema.repos);
}
