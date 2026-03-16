import { describe, it, expect } from "vitest";
import { FairygitMotherClient } from "@fairygitmother/node";

describe("FairygitMotherClient", () => {
	it("initializes with orchestrator URL", () => {
		const client = new FairygitMotherClient("http://localhost:3000");
		expect(client.registeredNodeId).toBeNull();
	});

	it("strips trailing slash from URL", () => {
		const client = new FairygitMotherClient("http://localhost:3000/");
		expect(client.registeredNodeId).toBeNull();
	});

	it("throws when heartbeat called before register", async () => {
		const client = new FairygitMotherClient("http://localhost:3000");
		await expect(client.heartbeat("idle")).rejects.toThrow("Not registered");
	});

	it("throws when claimBounty called before register", async () => {
		const client = new FairygitMotherClient("http://localhost:3000");
		await expect(client.claimBounty()).rejects.toThrow("Not registered");
	});

	it("throws when submitVote called before register", async () => {
		const client = new FairygitMotherClient("http://localhost:3000");
		await expect(
			client.submitVote("sub_123", {
				decision: "approve",
				reasoning: "LGTM",
				issuesFound: [],
				confidence: 0.9,
				testsRun: false,
			}),
		).rejects.toThrow("Not registered");
	});
});
