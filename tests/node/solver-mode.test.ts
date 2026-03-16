import { isRepoTrusted, selectSolverMode } from "@fairygitmother/node";
import { describe, expect, it } from "vitest";

describe("selectSolverMode", () => {
	const noTrust: { owner: string; repo: string }[] = [];

	it("defaults to api mode when no trust configured", () => {
		const result = selectSolverMode("someorg", "somerepo", "api", noTrust, true);
		expect(result.mode).toBe("api");
	});

	it("uses container mode for trusted repo when Docker available", () => {
		const trusted = [{ owner: "myorg", repo: "myrepo" }];
		const result = selectSolverMode("myorg", "myrepo", "api", trusted, true);
		expect(result.mode).toBe("container");
		expect(result.reason).toContain("trusted repos list");
	});

	it("falls back to api mode for trusted repo when Docker unavailable", () => {
		const trusted = [{ owner: "myorg", repo: "myrepo" }];
		const result = selectSolverMode("myorg", "myrepo", "api", trusted, false);
		expect(result.mode).toBe("api");
		expect(result.reason).toContain("Docker is not available");
	});

	it("uses api mode for untrusted repo even if default is container", () => {
		const trusted = [{ owner: "myorg", repo: "myrepo" }];
		const result = selectSolverMode("other", "repo", "container", trusted, true);
		expect(result.mode).toBe("container");
	});

	it("uses container mode when default is container and Docker available", () => {
		const result = selectSolverMode("any", "repo", "container", noTrust, true);
		expect(result.mode).toBe("container");
	});

	it("falls back to api mode when default is container but no Docker", () => {
		const result = selectSolverMode("any", "repo", "container", noTrust, false);
		expect(result.mode).toBe("api");
	});

	it("supports wildcard repo trust", () => {
		const trusted = [{ owner: "myorg", repo: "*" }];
		const result = selectSolverMode("myorg", "any-repo-here", "api", trusted, true);
		expect(result.mode).toBe("container");
	});

	it("is case-insensitive for owner/repo matching", () => {
		const trusted = [{ owner: "MyOrg", repo: "MyRepo" }];
		const result = selectSolverMode("myorg", "myrepo", "api", trusted, true);
		expect(result.mode).toBe("container");
	});
});

describe("isRepoTrusted", () => {
	it("returns false for empty trust list", () => {
		expect(isRepoTrusted("org", "repo", [])).toBe(false);
	});

	it("returns true for exact match", () => {
		expect(isRepoTrusted("org", "repo", [{ owner: "org", repo: "repo" }])).toBe(true);
	});

	it("returns true for wildcard match", () => {
		expect(isRepoTrusted("org", "anything", [{ owner: "org", repo: "*" }])).toBe(true);
	});

	it("returns false for non-matching repo", () => {
		expect(isRepoTrusted("org", "other", [{ owner: "org", repo: "repo" }])).toBe(false);
	});

	it("returns false for non-matching owner", () => {
		expect(isRepoTrusted("other", "repo", [{ owner: "org", repo: "repo" }])).toBe(false);
	});
});
