import { describe, it, expect } from "vitest";
import { generateId, generateApiKey } from "@fairygitmother/core";

describe("generateId", () => {
	it("generates unique IDs", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateId()));
		expect(ids.size).toBe(100);
	});

	it("includes prefix when provided", () => {
		const id = generateId("bty");
		expect(id.startsWith("bty_")).toBe(true);
	});

	it("generates without prefix", () => {
		const id = generateId();
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("generateApiKey", () => {
	it("starts with mf_ prefix", () => {
		const key = generateApiKey();
		expect(key.startsWith("mf_")).toBe(true);
	});

	it("is 67 chars long (3 prefix + 64 hex)", () => {
		const key = generateApiKey();
		expect(key.length).toBe(67);
	});

	it("generates unique keys", () => {
		const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
		expect(keys.size).toBe(50);
	});
});
