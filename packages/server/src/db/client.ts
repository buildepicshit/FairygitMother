import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type FairygitMotherDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: FairygitMotherDb | null = null;
let _pgPool: pg.Pool | null = null;

export function getDb(connectionString: string): FairygitMotherDb {
	if (!_db) {
		_pgPool = new pg.Pool({
			connectionString,
			ssl: connectionString.includes("azure") ? { rejectUnauthorized: false } : undefined,
			max: 10,
			connectionTimeoutMillis: 10_000,
		});
		_pgPool.on("error", (err) => {
			console.error("[db] Idle pool client error:", err.message);
		});
		_db = drizzle(_pgPool, { schema });
	}
	return _db;
}

export function closeDb() {
	if (_pgPool) {
		_pgPool.end();
		_pgPool = null;
	}
	_db = null;
}
