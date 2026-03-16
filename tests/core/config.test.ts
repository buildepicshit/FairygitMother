import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, FairygitMotherConfigSchema } from "@fairygitmother/core";

describe("loadConfig", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns defaults when no env vars set", () => {
		delete process.env.FAIRYGITMOTHER_ORCHESTRATOR_URL;
		delete process.env.FAIRYGITMOTHER_PORT;
		const config = loadConfig();
		expect(config.orchestratorUrl).toBe("http://localhost:3000");
		expect(config.port).toBe(3000);
		expect(config.solverBackend).toBe("openclaw");
		expect(config.idleThresholdMinutes).toBe(5);
		expect(config.maxDiffLines).toBe(500);
		expect(config.maxDiffFiles).toBe(10);
	});

	it("reads from environment variables", () => {
		process.env.FAIRYGITMOTHER_ORCHESTRATOR_URL = "http://grid.example.com";
		process.env.FAIRYGITMOTHER_PORT = "8080";
		const config = loadConfig();
		expect(config.orchestratorUrl).toBe("http://grid.example.com");
		expect(config.port).toBe(8080);
	});

	it("accepts overrides", () => {
		const config = loadConfig({ port: 9999, solverBackend: "claude" });
		expect(config.port).toBe(9999);
		expect(config.solverBackend).toBe("claude");
	});

	it("reads GITHUB_TOKEN", () => {
		process.env.GITHUB_TOKEN = "ghp_test123";
		const config = loadConfig();
		expect(config.githubToken).toBe("ghp_test123");
	});

	it("falls back to GH_TOKEN", () => {
		delete process.env.GITHUB_TOKEN;
		process.env.GH_TOKEN = "gh_fallback";
		const config = loadConfig();
		expect(config.githubToken).toBe("gh_fallback");
	});
});

describe("FairygitMotherConfigSchema", () => {
	it("rejects invalid port", () => {
		expect(() => FairygitMotherConfigSchema.parse({ port: 0 })).toThrow();
		expect(() => FairygitMotherConfigSchema.parse({ port: 70000 })).toThrow();
	});

	it("rejects invalid orchestrator URL", () => {
		expect(() => FairygitMotherConfigSchema.parse({ orchestratorUrl: "not-a-url" })).toThrow();
	});
});
