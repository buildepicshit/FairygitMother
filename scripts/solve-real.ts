/**
 * Solve a real GitHub issue end-to-end.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... pnpm solve <owner> <repo> <issue_number>
 *
 * Example:
 *   ANTHROPIC_API_KEY=sk-... pnpm solve octocat Spoon-Knife 1
 *
 * This script:
 *   1. Starts the FairygitMother server (temp DB)
 *   2. Registers a solver node + 2 reviewer nodes
 *   3. Fetches the real issue from GitHub
 *   4. Submits it as a bounty
 *   5. Solver claims it
 *   6. Fetches repo tree + files via GitHub API
 *   7. Calls Claude API to produce a fix
 *   8. Generates a diff and submits it
 *   9. Both reviewers call Claude API to review
 *   10. Reports consensus result
 */

import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { createApp } from "../packages/server/src/app.js";
import { runMigrations } from "../packages/server/src/db/migrate.js";
import * as schema from "../packages/server/src/db/schema.js";
import { stopAll } from "../packages/server/src/orchestrator/scheduler.js";

import {
	FairygitMotherClient,
	fetchFiles,
	fetchRepoTree,
	generateUnifiedDiff,
	reviewFix,
	solveBounty,
} from "../packages/node/src/index.js";

import { GitHubClient } from "../packages/core/src/index.js";

// ── Config ─────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEPARATOR = "=".repeat(60);

const args = process.argv.slice(2);
if (args.length < 3) {
	console.error("Usage: ANTHROPIC_API_KEY=sk-... pnpm solve <owner> <repo> <issue_number>");
	process.exit(1);
}

const [owner, repo, issueStr] = args;
const issueNumber = Number.parseInt(issueStr, 10);
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!anthropicKey) {
	console.error("ANTHROPIC_API_KEY environment variable is required");
	process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────

function log(step: number, msg: string) {
	console.log(`\n${SEPARATOR}\n  Step ${step}: ${msg}\n${SEPARATOR}`);
}

function ok(msg: string) {
	console.log(`  [OK] ${msg}`);
}

function info(msg: string) {
	console.log(`  [..] ${msg}`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
	const migrationsDir = resolve(__dirname, "../migrations");
	const tmpDbName = `solve-${randomBytes(4).toString("hex")}.db`;
	const dbPath = resolve(__dirname, "..", tmpDbName);
	let sqlite: Database.Database | null = null;
	let server: ReturnType<typeof serve> | null = null;
	let port = 0;

	try {
		// Step 1: Start server
		log(1, "Starting FairygitMother server");
		runMigrations(dbPath, migrationsDir);
		sqlite = new Database(dbPath);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		const db = drizzle(sqlite, { schema });
		const app = createApp(db);
		server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
		await new Promise<void>((resolve, reject) => {
			server!.once("listening", resolve);
			server!.once("error", reject);
		});
		const addr = server.address();
		if (typeof addr === "object" && addr !== null) port = addr.port;
		const baseUrl = `http://127.0.0.1:${port}`;
		ok(`Server on ${baseUrl}`);

		// Step 2: Register nodes
		log(2, "Registering nodes (1 solver + 2 reviewers)");
		const solver = new FairygitMotherClient(baseUrl);
		await solver.register({
			displayName: "claude-solver",
			capabilities: { languages: [], tools: ["claude-api"] },
			solverBackend: "claude-api",
		});
		ok(`Solver: ${solver.registeredNodeId}`);

		// Lift solver out of probation for 2-of-3 consensus
		db.update(schema.nodes)
			.set({ totalBountiesSolved: 10 })
			.where(schema.eq(schema.nodes.id, solver.registeredNodeId!))
			.run();

		const reviewers: FairygitMotherClient[] = [];
		for (let i = 0; i < 2; i++) {
			const r = new FairygitMotherClient(baseUrl);
			await r.register({
				displayName: `claude-reviewer-${i + 1}`,
				capabilities: { languages: [], tools: ["claude-api"] },
				solverBackend: "claude-api",
			});
			// Lift out of probation + set rep high enough to review
			db.update(schema.nodes)
				.set({ totalBountiesSolved: 10, reputationScore: 60 })
				.where(schema.eq(schema.nodes.id, r.registeredNodeId!))
				.run();
			reviewers.push(r);
			ok(`Reviewer ${i + 1}: ${r.registeredNodeId}`);
		}

		// Step 3: Fetch the real issue
		log(3, `Fetching issue: ${owner}/${repo}#${issueNumber}`);
		const github = new GitHubClient(process.env.GITHUB_TOKEN);
		const issue = await github.fetchIssue(owner, repo, issueNumber);
		ok(`Issue: "${issue.title}"`);
		info(
			`Body: ${(issue.body ?? "").slice(0, 200)}${(issue.body ?? "").length > 200 ? "..." : ""}`,
		);

		// Step 4: Submit bounty
		log(4, "Submitting bounty");
		const _bountyRes = await solver.getStats(); // just to verify server is up
		const submitRes = await fetch(`${baseUrl}/api/v1/bounties`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner,
				repo,
				issueNumber: issue.number,
				issueTitle: issue.title,
				issueBody: issue.body ?? "",
				labels: issue.labels.map((l: any) => l.name),
				language: null,
			}),
		});
		const bounty = (await submitRes.json()) as { bountyId: string };
		ok(`Bounty: ${bounty.bountyId}`);

		// Step 5: Claim
		log(5, "Solver claiming bounty");
		const claimed = await solver.claimBounty();
		if (!claimed.bounty) {
			console.error("  [FAIL] No bounty available");
			process.exit(1);
		}
		ok(`Claimed: ${claimed.bounty.issueTitle}`);

		// Step 6: Fetch repo files via GitHub API
		log(6, "Fetching repo tree + files via GitHub API");
		let tree: Awaited<ReturnType<typeof fetchRepoTree>>;
		try {
			tree = await fetchRepoTree(github, owner, repo, "HEAD");
		} catch {
			// Try 'main' branch
			tree = await fetchRepoTree(github, owner, repo, "main");
		}
		ok(`Tree: ${tree.files.length} files`);

		// Identify and fetch relevant files
		const relevantPaths = tree.files
			.filter((f) => f.size < 50_000) // Skip large files
			.filter((f) => !f.path.includes("node_modules"))
			.filter((f) => !f.path.includes(".min."))
			.filter((f) => !f.path.endsWith(".lock"))
			.slice(0, 25)
			.map((f) => f.path);

		const files = await fetchFiles(github, owner, repo, relevantPaths);
		ok(`Fetched ${files.length} files`);
		for (const f of files.slice(0, 5)) {
			info(`  ${f.path} (${f.size} bytes)`);
		}

		// Step 7: Call Claude to solve
		log(7, "Calling Claude API to solve the issue");
		const solveStart = Date.now();
		const result = await solveBounty(claimed.bounty as any, files, tree, { apiKey: anthropicKey });
		const solveDuration = Date.now() - solveStart;

		if (!result.success) {
			console.error(`  [FAIL] Solver failed: ${result.error}`);
			process.exit(1);
		}
		ok(`Fix produced in ${(solveDuration / 1000).toFixed(1)}s (${result.tokensUsed} tokens)`);
		ok(`Explanation: ${result.explanation.slice(0, 200)}`);
		ok(`Changed ${result.changes.length} file(s):`);
		for (const c of result.changes) {
			info(`  ${c.path}`);
		}

		// Step 8: Generate diff and submit
		log(8, "Generating diff and submitting fix");
		const diff = generateUnifiedDiff(result.changes);
		console.log(`\n${diff}\n`);

		const fixRes = await solver.submitFix(bounty.bountyId, {
			diff,
			explanation: result.explanation,
			filesChanged: result.changes.map((c) => c.path),
			testsPassed: null,
			tokensUsed: result.tokensUsed,
			solverBackend: "claude-api",
			solveDurationMs: solveDuration,
		});

		if (fixRes.status !== "accepted") {
			console.error(`  [FAIL] Fix rejected: ${(fixRes as any).safetyIssues?.join(", ")}`);
			process.exit(1);
		}
		ok(`Submitted: ${fixRes.submissionId}`);

		// Step 9: Reviewers vote
		log(9, "Reviewers calling Claude API to review the fix");
		for (let i = 0; i < reviewers.length; i++) {
			const reviewResult = await reviewFix(claimed.bounty as any, diff, result.explanation, files, {
				apiKey: anthropicKey,
			});
			ok(
				`Reviewer ${i + 1}: ${reviewResult.decision} (confidence: ${reviewResult.confidence}, ${reviewResult.tokensUsed} tokens)`,
			);
			if (reviewResult.issuesFound.length > 0) {
				info(`  Issues: ${reviewResult.issuesFound.join(", ")}`);
			}

			await reviewers[i].submitVote(fixRes.submissionId!, {
				decision: reviewResult.decision,
				reasoning: reviewResult.reasoning,
				issuesFound: reviewResult.issuesFound,
				confidence: reviewResult.confidence,
				testsRun: false,
			});
		}

		// Step 10: Check consensus
		log(10, "Checking consensus");
		const consensusRow = db
			.select()
			.from(schema.consensusResults)
			.where(schema.eq(schema.consensusResults.submissionId, fixRes.submissionId!))
			.get();

		const bountyRow = db
			.select()
			.from(schema.bounties)
			.where(schema.eq(schema.bounties.id, bounty.bountyId))
			.get();

		console.log(`
  ==========================================
    FairygitMother Real Solve — COMPLETE
  ==========================================

  Issue:         ${owner}/${repo}#${issueNumber}
  Title:         ${issue.title}
  Bounty:        ${bounty.bountyId}
  Submission:    ${fixRes.submissionId}
  Consensus:     ${consensusRow?.outcome?.toUpperCase() ?? "PENDING"}
  Votes:         ${consensusRow?.approveCount ?? 0} approve / ${consensusRow?.rejectCount ?? 0} reject
  Bounty Status: ${bountyRow?.status}
  Solve Time:    ${(solveDuration / 1000).toFixed(1)}s
  Tokens Used:   ${result.tokensUsed}

  Files Changed:
${result.changes.map((c) => `    ${c.path}`).join("\n")}

  Explanation:
    ${result.explanation}
`);
	} finally {
		stopAll();
		if (server) server.close();
		if (sqlite) sqlite.close();
		if (existsSync(dbPath)) unlinkSync(dbPath);
		const walPath = `${dbPath}-wal`;
		const shmPath = `${dbPath}-shm`;
		if (existsSync(walPath)) unlinkSync(walPath);
		if (existsSync(shmPath)) unlinkSync(shmPath);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
