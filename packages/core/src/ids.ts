import { randomBytes } from "node:crypto";

export function generateId(prefix = ""): string {
	const hex = randomBytes(8).toString("hex");
	return prefix ? `${prefix}_${hex}` : hex;
}

export function generateApiKey(): string {
	return `mf_${randomBytes(32).toString("hex")}`;
}
