import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { type NodePgDatabase, drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type FairygitMotherDb = BetterSQLite3Database<typeof schema> | NodePgDatabase<typeof schema>;

let _db: FairygitMotherDb | null = null;
let _sqlite: Database.Database | null = null;
let _pgPool: pg.Pool | null = null;

/**
 * Get a SQLite database connection (for tests and local dev without DATABASE_URL).
 */
export function getDb(dbPath = "fairygitmother.db"): FairygitMotherDb {
	if (!_db) {
		_sqlite = new Database(dbPath);
		_sqlite.pragma("journal_mode = DELETE");
		_sqlite.pragma("busy_timeout = 5000");
		_sqlite.pragma("foreign_keys = ON");
		_db = drizzleSqlite(_sqlite, { schema });
	}
	return _db;
}

/**
 * Get a PostgreSQL database connection (for production with DATABASE_URL).
 */
export function getPgDb(connectionString: string): FairygitMotherDb {
	if (!_db) {
		_pgPool = new pg.Pool({
			connectionString,
			ssl: { rejectUnauthorized: false },
			max: 10,
		});
		_db = drizzlePg(_pgPool, { schema });
	}
	return _db;
}

export function closeDb() {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
	}
	if (_pgPool) {
		_pgPool.end();
		_pgPool = null;
	}
	_db = null;
}
