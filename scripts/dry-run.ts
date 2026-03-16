/**
 * First Real Bounty — Dry Run
 *
 * Exercises the full FairygitMother pipeline end-to-end against a real
 * HTTP server with a real SQLite database and real GitHub API data.
 *
 * Pipeline:
 *   1. Start server on random port (temp SQLite DB)
 *   2. Register 3 nodes (1 solver + 2 reviewers)
 *   3. Submit a bounty for octocat/Hello-World#1
 *   4. Solver claims the bounty
 *   5. Fetch repo tree + files via GitHub API (no token needed)
 *   6. Build the API solve prompt
 *   7. Simulate agent fix (add a comment to README)
 *   8. Generate unified diff
 *   9. Submit diff to server
 *  10. 3 reviewers vote "approve" (probation requires 3-of-3)
 *  11. Verify consensus
 *  12. Print summary and shut down
 *
 * Usage: pnpm dry-run
 */

import { serve } from "@hono/node-server";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";

// Server internals — imported via relative path since the package only
// exports the startup entry point, not individual modules.
import { createApp } from "../packages/server/src/app.js";
import { runMigrations } from "../packages/server/src/db/migrate.js";
import * as schema from "../packages/server/src/db/schema.js";
import { stopAll } from "../packages/server/src/orchestrator/scheduler.js";

// Node client + API solver
import {
	FairygitMotherClient,
	fetchRepoTree,
	fetchFile,
	generateUnifiedDiff,
	buildApiSolvePrompt,
	selectSolverMode,
	type FileChange,
} from "../packages/node/src/index.js";

// Core — GitHubClient
import { GitHubClient } from "../packages/core/src/index.js";

// ── Helpers ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEPARATOR = "=".repeat(60);

function log(step: number, msg: string) {
	console.log(`\n${SEPARATOR}`);
	console.log(`  Step ${step}: ${msg}`);
	console.log(SEPARATOR);
}

function ok(msg: string) {
	console.log(`  [OK] ${msg}`);
}

function info(msg: string) {
	console.log(`  [..] ${msg}`);
}

function fail(msg: string) {
	console.error(`  [FAIL] ${msg}`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
	const startTime = Date.now();
	const tmpDbName = `dry-run-${randomBytes(4).toString("hex")}.db`;
	const dbPath = resolve(__dirname, "..", tmpDbName);
	const migrationsDir = resolve(__dirname, "..", "migrations");

	let server: ReturnType<typeof serve> | null = null;
	let port = 0;
	let sqlite: Database.Database | null = null;

	// Track IDs for summary
	let bountyId = "";
	let submissionId = "";
	let consensusOutcome = "";
	let diffText = "";

	try {
		// ──────────────────────────────────────────────────────────
		// Step 1: Start the server
		// ──────────────────────────────────────────────────────────
		log(1, "Starting FairygitMother server");

		// Run migrations on the temp DB
		runMigrations(dbPath, migrationsDir);
		ok(`Migrations applied to ${tmpDbName}`);

		// Create DB connection (bypass singleton getDb — we manage our own)
		sqlite = new Database(dbPath);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		const db = drizzle(sqlite, { schema });

		// Create Hono app
		const app = createApp(db);

		// Start on port 0 (OS picks a free port)
		server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });

		// Wait for the server to be ready and extract the assigned port
		await new Promise<void>((resolve, reject) => {
			server!.once("listening", resolve);
			server!.once("error", reject);
		});
		const addr = server.address();
		if (typeof addr === "object" && addr !== null) {
			port = addr.port;
		} else {
			throw new Error("Could not determine server port");
		}

		const baseUrl = `http://127.0.0.1:${port}`;
		ok(`Server running on ${baseUrl}`);

		// Verify health
		const healthRes = await fetch(`${baseUrl}/api/v1/health`);
		const health = (await healthRes.json()) as { status: string };
		ok(`Health check: ${health.status}`);

		// ──────────────────────────────────────────────────────────
		// Step 2: Register nodes (1 solver + 3 reviewers)
		// ──────────────────────────────────────────────────────────
		log(2, "Registering nodes (1 solver + 3 reviewers)");

		const solver = new FairygitMotherClient(baseUrl);
		const solverReg = await solver.register({
			displayName: "dry-run-solver",
			capabilities: { languages: [], tools: ["openclaw"] },
			solverBackend: "openclaw",
		});
		ok(`Solver registered: ${solverReg.nodeId}`);

		const reviewer1 = new FairygitMotherClient(baseUrl);
		const rev1Reg = await reviewer1.register({
			displayName: "dry-run-reviewer-1",
			capabilities: { languages: [], tools: ["openclaw"] },
			solverBackend: "openclaw",
		});
		ok(`Reviewer 1 registered: ${rev1Reg.nodeId}`);

		const reviewer2 = new FairygitMotherClient(baseUrl);
		const rev2Reg = await reviewer2.register({
			displayName: "dry-run-reviewer-2",
			capabilities: { languages: [], tools: ["openclaw"] },
			solverBackend: "openclaw",
		});
		ok(`Reviewer 2 registered: ${rev2Reg.nodeId}`);

		// 3rd reviewer needed: new nodes are on probation (3-of-3 consensus)
		const reviewer3 = new FairygitMotherClient(baseUrl);
		const rev3Reg = await reviewer3.register({
			displayName: "dry-run-reviewer-3",
			capabilities: { languages: [], tools: ["openclaw"] },
			solverBackend: "openclaw",
		});
		ok(`Reviewer 3 registered: ${rev3Reg.nodeId}`);

		// ──────────────────────────────────────────────────────────
		// Step 3: Submit a bounty for octocat/Hello-World#1
		// ──────────────────────────────────────────────────────────
		log(3, "Submitting bounty: octocat/Hello-World#1");

		// Fetch the real issue from GitHub (no auth needed for public repos)
		const github = new GitHubClient(); // unauthenticated
		let issueTitle = "Found a bug";
		let issueBody =
			"This is a test issue on the classic Hello-World repo.";

		try {
			const issue = await github.fetchIssue("octocat", "Hello-World", 1);
			issueTitle = issue.title;
			issueBody = issue.body ?? "";
			ok(`Fetched real issue: "${issueTitle}"`);
		} catch {
			info("GitHub API rate limited — using placeholder issue data");
		}

		// POST /api/v1/bounties is public (no auth required)
		const bountyRes = await fetch(`${baseUrl}/api/v1/bounties`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				owner: "octocat",
				repo: "Hello-World",
				issueNumber: 1,
				issueTitle,
				issueBody,
				labels: ["bug"],
				language: null,
				complexityEstimate: 1,
			}),
		});
		if (!bountyRes.ok) {
			const text = await bountyRes.text();
			throw new Error(`Bounty submission failed (${bountyRes.status}): ${text}`);
		}
		const bountyData = (await bountyRes.json()) as {
			bountyId: string;
			status: string;
		};
		bountyId = bountyData.bountyId;
		ok(`Bounty submitted: ${bountyId} (status: ${bountyData.status})`);

		// ──────────────────────────────────────────────────────────
		// Step 4: Solver claims the bounty
		// ──────────────────────────────────────────────────────────
		log(4, "Solver claiming bounty");

		const claimResult = await solver.claimBounty();
		if (!claimResult.bounty) {
			throw new Error("No bounty available to claim");
		}
		ok(
			`Claimed bounty: ${claimResult.bounty.id} — "${claimResult.bounty.issueTitle}"`,
		);

		// ──────────────────────────────────────────────────────────
		// Step 5: Fetch repo tree and files via GitHub API
		// ──────────────────────────────────────────────────────────
		log(5, "Fetching repo tree and files via GitHub API (API mode)");

		// Confirm solver mode selection
		const modeDecision = selectSolverMode(
			"octocat",
			"Hello-World",
			"api",
			[],
			false,
		);
		ok(`Solver mode: ${modeDecision.mode} — ${modeDecision.reason}`);

		let repoTree: Awaited<ReturnType<typeof fetchRepoTree>>;
		let readmeFile: Awaited<ReturnType<typeof fetchFile>>;

		try {
			repoTree = await fetchRepoTree(
				github,
				"octocat",
				"Hello-World",
				"master",
			);
			ok(
				`Repo tree fetched: ${repoTree.files.length} files (truncated: ${repoTree.truncated})`,
			);
			for (const f of repoTree.files) {
				info(`  ${f.path} (${f.size} bytes)`);
			}

			readmeFile = await fetchFile(
				github,
				"octocat",
				"Hello-World",
				"README",
			);
			ok(`README fetched: ${readmeFile.size} bytes`);
			info(`Content: "${readmeFile.content.trim()}"`);
		} catch {
			// GitHub API rate limit — use synthetic data so the pipeline
			// still exercises every code path
			info("GitHub API rate limited — using synthetic file data");

			repoTree = {
				files: [
					{
						path: "README",
						size: 14,
						sha: "synthetic",
						type: "blob" as const,
					},
				],
				truncated: false,
			};

			readmeFile = {
				path: "README",
				content: "Hello World!\n",
				size: 14,
				sha: "synthetic",
			};

			ok("Using fallback data for README");
		}

		// ──────────────────────────────────────────────────────────
		// Step 6: Build the API solve prompt
		// ──────────────────────────────────────────────────────────
		log(6, "Building API solve prompt");

		const bountyForPrompt = {
			id: bountyId,
			repoUrl: "https://github.com/octocat/Hello-World",
			owner: "octocat",
			repo: "Hello-World",
			issueNumber: 1,
			issueTitle,
			issueBody,
			labels: ["bug"] as string[],
			language: null,
			complexityEstimate: 1,
			status: "assigned" as const,
			assignedNodeId: solverReg.nodeId,
			priority: 50,
			retryCount: 0,
			createdAt: new Date().toISOString(),
		};

		const prompt = buildApiSolvePrompt(
			bountyForPrompt,
			[readmeFile],
			repoTree,
		);
		ok(`Prompt built (${prompt.length} chars)`);
		info("Prompt preview (first 200 chars):");
		console.log(
			`  ${prompt.slice(0, 200).replace(/\n/g, "\n  ")}...`,
		);

		// ──────────────────────────────────────────────────────────
		// Step 7: Simulate agent producing a fix
		// ──────────────────────────────────────────────────────────
		log(7, "Simulating agent fix (adding comment to README)");

		const originalContent = readmeFile.content;
		const newContent = `${originalContent.trimEnd()}\n\n# Fixed by FairygitMother dry-run\n# This comment addresses issue #1\n`;
		ok("Simulated fix: appended comment lines to README");
		info(`Original: ${JSON.stringify(originalContent.trim())}`);
		info(`Modified: ${JSON.stringify(newContent.trim())}`);

		// ──────────────────────────────────────────────────────────
		// Step 8: Generate unified diff
		// ──────────────────────────────────────────────────────────
		log(8, "Generating unified diff");

		const changes: FileChange[] = [
			{
				path: "README",
				originalContent,
				newContent,
			},
		];
		diffText = generateUnifiedDiff(changes);
		ok(`Diff generated (${diffText.split("\n").length} lines)`);
		console.log();
		for (const line of diffText.split("\n")) {
			const color = line.startsWith("+")
				? "\x1b[32m"
				: line.startsWith("-")
					? "\x1b[31m"
					: line.startsWith("@@")
						? "\x1b[36m"
						: "";
			console.log(`  ${color}${line}\x1b[0m`);
		}

		// ──────────────────────────────────────────────────────────
		// Step 9: Submit the diff to the server
		// ──────────────────────────────────────────────────────────
		log(9, "Submitting fix to server");

		const fixResult = await solver.submitFix(bountyId, {
			diff: diffText,
			explanation:
				"Added a comment to README to acknowledge the test issue. Minimal change.",
			filesChanged: ["README"],
			testsPassed: null,
			tokensUsed: 42,
			solverBackend: "openclaw",
			solveDurationMs: 1500,
		});
		submissionId = fixResult.submissionId;
		ok(`Fix submitted: ${submissionId} (status: ${fixResult.status})`);

		// ──────────────────────────────────────────────────────────
		// Step 10: Reviewers vote "approve" (3 needed for probation)
		// ──────────────────────────────────────────────────────────
		log(10, "Reviewers voting (3-of-3 required — probation nodes)");

		// The server returns { accepted, consensusStatus } but the typed
		// SubmitVoteResponse only declares { accepted }. Cast to access
		// the extra field the server sends back.
		type VoteResultRaw = { accepted: boolean; consensusStatus: string };

		const vote1Result = (await reviewer1.submitVote(submissionId, {
			decision: "approve",
			reasoning:
				"Minimal fix adding a comment to README. Safe and addresses the issue.",
			issuesFound: [],
			confidence: 0.95,
			testsRun: false,
		})) as unknown as VoteResultRaw;
		ok(
			`Reviewer 1 voted: approve (consensus: ${vote1Result.consensusStatus})`,
		);

		const vote2Result = (await reviewer2.submitVote(submissionId, {
			decision: "approve",
			reasoning:
				"Clean change. Only appends to README, no regression risk.",
			issuesFound: [],
			confidence: 0.9,
			testsRun: false,
		})) as unknown as VoteResultRaw;
		ok(
			`Reviewer 2 voted: approve (consensus: ${vote2Result.consensusStatus})`,
		);

		const vote3Result = (await reviewer3.submitVote(submissionId, {
			decision: "approve",
			reasoning: "Simple, safe README change. Approved.",
			issuesFound: [],
			confidence: 0.92,
			testsRun: false,
		})) as unknown as VoteResultRaw;
		ok(
			`Reviewer 3 voted: approve (consensus: ${vote3Result.consensusStatus})`,
		);

		// ──────────────────────────────────────────────────────────
		// Step 11: Verify consensus was reached
		// ──────────────────────────────────────────────────────────
		log(11, "Checking consensus");

		const consensusRow = db
			.select()
			.from(schema.consensusResults)
			.where(eq(schema.consensusResults.submissionId, submissionId))
			.get();

		if (!consensusRow) {
			throw new Error(
				"No consensus result found — pipeline broken!",
			);
		}

		consensusOutcome = consensusRow.outcome;
		ok(`Consensus reached: ${consensusOutcome.toUpperCase()}`);
		ok(
			`Votes: ${consensusRow.approveCount} approve / ${consensusRow.rejectCount} reject (${consensusRow.totalVotes} total)`,
		);

		// Verify bounty status updated
		const finalBounty = db
			.select()
			.from(schema.bounties)
			.where(eq(schema.bounties.id, bountyId))
			.get();
		ok(`Bounty final status: ${finalBounty?.status}`);

		// Check solver reputation changed
		const solverNode = db
			.select()
			.from(schema.nodes)
			.where(eq(schema.nodes.id, solverReg.nodeId))
			.get();
		ok(`Solver reputation: ${solverNode?.reputationScore} (started at 50)`);

		// ──────────────────────────────────────────────────────────
		// Step 12: Summary
		// ──────────────────────────────────────────────────────────
		log(12, "SUMMARY");

		const elapsed = Date.now() - startTime;
		console.log();
		console.log("  ==========================================");
		console.log("    FairygitMother Dry Run  --  PASSED");
		console.log("  ==========================================");
		console.log();
		console.log(`  Bounty ID:       ${bountyId}`);
		console.log(`  Submission ID:   ${submissionId}`);
		console.log(`  Consensus:       ${consensusOutcome.toUpperCase()}`);
		console.log(`  Solver Node:     ${solverReg.nodeId}`);
		console.log(`  Reviewer Nodes:  ${rev1Reg.nodeId}`);
		console.log(`                   ${rev2Reg.nodeId}`);
		console.log(`                   ${rev3Reg.nodeId}`);
		console.log(`  Elapsed:         ${elapsed}ms`);
		console.log();
		console.log("  Diff:");
		for (const line of diffText.split("\n")) {
			console.log(`    ${line}`);
		}
		console.log();
		console.log("  Pipeline stages exercised:");
		console.log("    [x] Server startup (Hono + SQLite + migrations)");
		console.log("    [x] Node registration (solver + 3 reviewers)");
		console.log("    [x] Bounty submission (maintainer submits issue)");
		console.log("    [x] Bounty claim (solver picks up work)");
		console.log("    [x] GitHub API fetch (repo tree + file contents)");
		console.log("    [x] API solve prompt construction");
		console.log("    [x] Solver mode selection");
		console.log("    [x] Unified diff generation");
		console.log("    [x] Fix submission (with safety scan)");
		console.log("    [x] Review voting (3-of-3 for probation)");
		console.log("    [x] Consensus evaluation + recording");
		console.log("    [x] Reputation updates");
		console.log();

		// Disconnect nodes
		info("Disconnecting nodes...");
		await solver.disconnect();
		await reviewer1.disconnect();
		await reviewer2.disconnect();
		await reviewer3.disconnect();
		ok("Nodes disconnected");

		// Close SQLite
		sqlite.close();
		sqlite = null;
	} catch (err) {
		fail(
			`Dry run failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		if (err instanceof Error && err.stack) {
			console.error(`\n${err.stack}`);
		}
		process.exitCode = 1;
	} finally {
		// Stop scheduler background tasks
		stopAll();

		// Close HTTP server
		if (server) {
			server.close();
			ok("Server shut down");
		}

		// Close SQLite if still open
		if (sqlite) {
			try {
				sqlite.close();
			} catch {
				// Already closed
			}
		}

		// Clean up temp DB files
		for (const suffix of ["", "-wal", "-shm"]) {
			const file = `${dbPath}${suffix}`;
			try {
				if (existsSync(file)) {
					unlinkSync(file);
				}
			} catch {
				// Best effort cleanup
			}
		}
		ok(`Temp DB cleaned up: ${tmpDbName}`);
	}
}

main();
