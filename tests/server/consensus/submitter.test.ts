import { buildPrBody } from "@fairygitmother/server/consensus/submitter.js";
import { describe, expect, it } from "vitest";

describe("PR submitter", () => {
	describe("buildPrBody", () => {
		it("generates correct PR body", () => {
			const body = buildPrBody(
				"testorg",
				"testrepo",
				42,
				"Fixed the null check in the parser",
				"node_abc123",
				"openclaw",
				2,
				3,
			);

			expect(body).toContain("Fixes #42");
			expect(body).toContain("Fixed the null check in the parser");
			expect(body).toContain("`node_abc123` (openclaw)");
			expect(body).toContain("3 independent agents");
			expect(body).toContain("2/3 approved");
			expect(body).toContain("FairygitMother");
			expect(body).toContain("fairygitmother: false");
		});

		it("handles 3-of-3 consensus", () => {
			const body = buildPrBody("org", "repo", 1, "fix", "node_1", "test", 3, 3);
			expect(body).toContain("3/3 approved");
		});
	});
});
