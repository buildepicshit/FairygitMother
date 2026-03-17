import { type AuditEvent, generateId } from "@fairygitmother/core";
import type { FairygitMotherDb } from "./db/client.js";
import { auditLog } from "./db/schema.js";

export async function logAudit(
	db: FairygitMotherDb,
	event: AuditEvent,
	entityId: string,
	details?: Record<string, unknown>,
): Promise<string> {
	const id = generateId("audit");
	await db.insert(auditLog).values({
		id,
		event,
		entityId,
		details: details ?? null,
	});
	return id;
}
