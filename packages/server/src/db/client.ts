import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbPath = "fairygitmother.db") {
	if (!_db) {
		_sqlite = new Database(dbPath);
		_sqlite.pragma("journal_mode = DELETE");
		_sqlite.pragma("busy_timeout = 5000");
		_sqlite.pragma("foreign_keys = ON");
		_db = drizzle(_sqlite, { schema });
	}
	return _db;
}

export function closeDb() {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
		_db = null;
	}
}

export type FairygitMotherDb = ReturnType<typeof getDb>;
