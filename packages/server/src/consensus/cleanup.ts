import type { GitHubClient } from "@fairygitmother/core";
import { eq } from "drizzle-orm";
import { pushToNode } from "../api/node-push.js";
import { logAudit } from "../audit.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes, submissions } from "../db/schema.js";

/**
 * Check all bounties in `pr_submitted` status, query the upstream PR state,
 * and transition to `pr_merged` or `pr_closed`. On merge or close, delete
 * the fork branch to keep the fork clean.
 */
export async function cleanupMergedPrs(
	db: FairygitMotherDb,
	github: GitHubClient,
	forkOwner: string,
): Promise<{ merged: number; closed: number }> {
	const submitted = await db.select().from(bounties).where(eq(bounties.status, "pr_submitted"));

	let merged = 0;
	let closed = 0;

	for (const bounty of submitted) {
		try {
			// Find the consensus result with the PR URL
			const consensus = (
				await db
					.select()
					.from(consensusResults)
					.innerJoin(submissions, eq(submissions.id, consensusResults.submissionId))
					.where(eq(submissions.bountyId, bounty.id))
			)[0];

			if (!consensus?.consensus_results.prUrl) continue;

			const prNumber = extractPrNumber(consensus.consensus_results.prUrl);
			if (!prNumber) continue;

			const pr = await github.getPullRequestState(bounty.owner, bounty.repo, prNumber);

			if (pr.state === "open") continue;

			// PR is closed (merged or rejected)
			const newStatus = pr.merged ? "pr_merged" : "pr_closed";
			await db
				.update(bounties)
				.set({ status: newStatus, updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, bounty.id));

			// Delete the fork branch
			const submission = (
				await db.select().from(submissions).where(eq(submissions.bountyId, bounty.id))
			)[0];
			if (submission) {
				const branchName = `fairygitmother/fix-${bounty.issueNumber}-${submission.id.slice(0, 8)}`;
				try {
					await github.deleteRef(forkOwner, bounty.repo, `heads/${branchName}`);
				} catch {
					// Branch may already be deleted (e.g. GitHub auto-delete on merge)
				}
			}

			if (pr.merged) {
				merged++;
				const { applyReputationEvent } = await import("../orchestrator/reputation.js");
				if (submission) {
					await applyReputationEvent(db, submission.nodeId, "fix_merged");
				}
			} else {
				closed++;
				if (submission) {
					const { applyReputationEvent } = await import("../orchestrator/reputation.js");
					await applyReputationEvent(db, submission.nodeId, "fix_closed");
				}
			}

			// Notify the solver of the outcome (reinforcement feedback)
			if (submission) {
				const solverNode = (
					await db.select().from(nodes).where(eq(nodes.id, submission.nodeId))
				)[0];
				pushToNode(submission.nodeId, {
					type: pr.merged ? "fix_merged" : "fix_closed",
					bountyId: bounty.id,
					owner: bounty.owner,
					repo: bounty.repo,
					issueNumber: bounty.issueNumber,
					issueTitle: bounty.issueTitle,
					prUrl: consensus.consensus_results.prUrl,
					reputationDelta: pr.merged ? 5 : -3,
					newReputationScore: solverNode?.reputationScore ?? null,
				});
			}

			await logAudit(db, "pr_cleanup", bounty.id, {
				prNumber,
				newStatus,
				merged: pr.merged,
			});
		} catch (err) {
			console.error(`[cleanup] Failed to check PR for bounty ${bounty.id}:`, err);
		}
	}

	return { merged, closed };
}

function extractPrNumber(prUrl: string): number | null {
	const match = prUrl.match(/\/pull\/(\d+)$/);
	return match ? Number.parseInt(match[1], 10) : null;
}
