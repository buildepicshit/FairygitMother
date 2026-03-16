import { generateId, type AuditEvent } from "@fairygitmother/core";
import type { FairygitMotherDb } from "./db/client.js";
import { auditLog } from "./db/schema.js";

export function logAudit(
	db: FairygitMotherDb,
	event: AuditEvent,
	entityId: string,
	details?: Record<string, unknown>,
): string {
	const id = generateId("audit");
	db.insert(auditLog)
		.values({
			id,
			event,
			entityId,
			details: details ?? null,
		})
		.run();
	return id;
}
