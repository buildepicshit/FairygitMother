/**
 * Live E2E pipeline test against the production server.
 *
 * Registers 3 nodes (1 solver + 2 reviewers), submits a bounty,
 * claims it, submits a fix, reviews it with 2/2 approval, and
 * verifies the consensus result.
 *
 * Usage: ORCHESTRATOR_URL=https://fairygitmother.ai npx tsx scripts/e2e-live.ts
 */

const BASE = process.env.ORCHESTRATOR_URL ?? "https://fairygitmother.ai";

async function api(path: string, method = "GET", body?: unknown, apiKey?: string) {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});

	const text = await res.text();
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = text;
	}

	if (!res.ok && res.status !== 409) {
		console.error(`  FAIL ${method} ${path} → ${res.status}:`, json);
		process.exit(1);
	}
	return { status: res.status, data: json as Record<string, unknown> };
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  ASSERTION FAILED: ${message}`);
		process.exit(1);
	}
	console.log(`  OK: ${message}`);
}

async function main() {
	console.log(`\n=== FairygitMother Live E2E Test ===`);
	console.log(`Server: ${BASE}\n`);

	// 1. Health check
	console.log("1. Health check...");
	const health = await api("/api/v1/health");
	assert(health.data.status === "ok", "Server is healthy");

	// 2. Register 3 nodes
	console.log("\n2. Registering nodes...");
	const solver = await api("/api/v1/nodes/register", "POST", {
		displayName: "e2e-solver",
		capabilities: { languages: ["TypeScript", "Python"], tools: ["openclaw"] },
		solverBackend: "openclaw",
	});
	const solverNodeId = solver.data.nodeId as string;
	const solverKey = solver.data.apiKey as string;
	console.log(`  Solver: ${solverNodeId}`);

	const reviewer1 = await api("/api/v1/nodes/register", "POST", {
		displayName: "e2e-reviewer-1",
		capabilities: { languages: ["TypeScript", "Python"], tools: ["openclaw"] },
		solverBackend: "openclaw",
	});
	const r1Key = reviewer1.data.apiKey as string;
	console.log(`  Reviewer 1: ${reviewer1.data.nodeId}`);

	const reviewer2 = await api("/api/v1/nodes/register", "POST", {
		displayName: "e2e-reviewer-2",
		capabilities: { languages: ["TypeScript", "Python"], tools: ["openclaw"] },
		solverBackend: "openclaw",
	});
	const r2Key = reviewer2.data.apiKey as string;
	console.log(`  Reviewer 2: ${reviewer2.data.nodeId}`);

	// 3. Submit a test bounty
	console.log("\n3. Submitting bounty...");
	const bounty = await api("/api/v1/bounties", "POST", {
		owner: "buildepicshit",
		repo: "FairygitMother",
		issueNumber: 9999,
		issueTitle: "[E2E Test] Pipeline validation",
		issueBody: "This is an automated E2E pipeline test. This bounty tests the full lifecycle: submit → claim → fix → review → consensus.",
		labels: ["e2e-test"],
		language: "TypeScript",
		complexityEstimate: 1,
	});

	if (bounty.status === 409) {
		console.log("  Bounty already exists (reusing)");
	} else {
		assert(bounty.status === 201, `Bounty created: ${bounty.data.bountyId}`);
	}

	// 4. Solver claims the bounty
	console.log("\n4. Claiming bounty...");
	const claim = await api("/api/v1/bounties/claim", "POST", { apiKey: solverKey });
	const claimedBounty = claim.data.bounty as Record<string, unknown> | null;

	if (!claimedBounty) {
		console.log("  No bounty available to claim (queue may be empty)");
		console.log("  This is expected if bounties were already claimed in previous runs.");
		console.log("\n=== E2E Test PARTIAL (no claimable bounty) ===\n");
		return;
	}

	const bountyId = claimedBounty.id as string;
	assert(!!bountyId, `Claimed bounty: ${bountyId}`);
	console.log(`  Title: ${claimedBounty.issueTitle}`);

	// 5. Submit a fix
	console.log("\n5. Submitting fix...");
	const diff = [
		"--- a/README.md",
		"+++ b/README.md",
		"@@ -1,3 +1,3 @@",
		" # FairygitMother",
		"-Distributed Agent Grid for Open Source Maintenance.",
		"+Distributed Agent Grid for Open Source Maintenance. No token goes unused.",
		' "No token goes unused."',
	].join("\n");

	const fix = await api(`/api/v1/bounties/${bountyId}/submit`, "POST", {
		diff,
		explanation: "Added the tagline to the README header for clarity",
		filesChanged: ["README.md"],
		testsPassed: true,
		tokensUsed: 500,
		solverBackend: "openclaw",
		solveDurationMs: 3000,
	}, solverKey);

	assert(fix.data.status === "accepted", `Fix accepted: ${fix.data.submissionId}`);
	const submissionId = fix.data.submissionId as string;

	// 6. Reviewer 1 approves
	console.log("\n6. Reviewer 1 voting...");
	const vote1 = await api(`/api/v1/reviews/${submissionId}/vote`, "POST", {
		decision: "approve",
		reasoning: "Clean minimal change. The tagline adds context without modifying functionality. LGTM.",
		issuesFound: [],
		confidence: 0.95,
		testsRun: false,
	}, r1Key);
	assert(vote1.data.accepted === true, "Vote 1 accepted");
	console.log(`  Consensus status: ${vote1.data.consensusStatus}`);

	// 7. Reviewer 2 approves
	console.log("\n7. Reviewer 2 voting...");
	const vote2 = await api(`/api/v1/reviews/${submissionId}/vote`, "POST", {
		decision: "approve",
		reasoning: "Straightforward documentation improvement. No code impact. Approved.",
		issuesFound: [],
		confidence: 0.9,
		testsRun: false,
	}, r2Key);
	assert(vote2.data.accepted === true, "Vote 2 accepted");
	console.log(`  Consensus status: ${vote2.data.consensusStatus}`);

	// Probation nodes need 3/3 — check if we need a third vote
	if (vote2.data.consensusStatus === "pending") {
		console.log("\n7b. Solver is on probation, need 3rd reviewer...");
		const reviewer3 = await api("/api/v1/nodes/register", "POST", {
			displayName: "e2e-reviewer-3",
			capabilities: { languages: [], tools: [] },
			solverBackend: "openclaw",
		});
		const r3Key = reviewer3.data.apiKey as string;

		const vote3 = await api(`/api/v1/reviews/${submissionId}/vote`, "POST", {
			decision: "approve",
			reasoning: "Documentation-only change. No regression risk. Approved.",
			issuesFound: [],
			confidence: 0.85,
			testsRun: false,
		}, r3Key);
		assert(vote3.data.accepted === true, "Vote 3 accepted");
		console.log(`  Consensus status: ${vote3.data.consensusStatus}`);
		assert(vote3.data.consensusStatus === "approved", "Consensus reached with 3/3");
	} else {
		assert(vote2.data.consensusStatus === "approved", "Consensus reached with 2/2");
	}

	// 8. Verify final stats
	console.log("\n8. Verifying stats...");
	const stats = await api("/api/v1/stats");
	console.log(`  Active nodes: ${stats.data.activeNodes}`);
	console.log(`  Total nodes: ${stats.data.totalNodes}`);
	console.log(`  PRs submitted all time: ${stats.data.prsSubmittedAllTime}`);
	console.log(`  Merge rate: ${stats.data.mergeRate}`);

	console.log("\n=== E2E Test PASSED ===\n");
}

main().catch((err) => {
	console.error("E2E test failed:", err);
	process.exit(1);
});
