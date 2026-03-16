import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString: string) {
	if (!_db) {
		_sql = postgres(connectionString, { max: 10 });
		_db = drizzle(_sql, { schema });
	}
	return _db;
}

export async function closeDb() {
	if (_sql) {
		await _sql.end();
		_sql = null;
		_db = null;
	}
}

export type FairygitMotherDb = ReturnType<typeof getDb>;
