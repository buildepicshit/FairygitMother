import { type GitHubClient, generateId } from "@fairygitmother/core";
import { eq, sql } from "drizzle-orm";
import { emitEvent } from "../api/feed.js";
import { pushToNode } from "../api/node-push.js";
import { logAudit } from "../audit.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes, submissions, votes } from "../db/schema.js";
import { applyReputationEvent, getConsensusRequirement } from "../orchestrator/reputation.js";
import { submitPr } from "./submitter.js";

export type ConsensusDecision = "approved" | "rejected" | "pending" | "timeout";

export async function evaluateConsensus(
	db: FairygitMotherDb,
	submissionId: string,
): Promise<ConsensusDecision> {
	const submission = (
		await db.select().from(submissions).where(eq(submissions.id, submissionId))
	)[0];
	if (!submission) return "pending";

	const allVotes = await db.select().from(votes).where(eq(votes.submissionId, submissionId));

	const required = await getConsensusRequirement(db, submission.nodeId);
	const approvals = allVotes.filter((v) => v.decision === "approve").length;
	const rejections = allVotes.filter((v) => v.decision === "reject").length;

	// 2-of-3 (or 3-of-3 for probation) to approve
	if (approvals >= required) return "approved";

	// 2 rejections = immediate reject
	if (rejections >= 2) return "rejected";

	// Check timeout (30 min since submission)
	const submittedAt = new Date(submission.submittedAt).getTime();
	const elapsed = Date.now() - submittedAt;
	if (elapsed > 30 * 60 * 1000 && allVotes.length < required) {
		return "timeout";
	}

	return "pending";
}

export interface PrSubmitContext {
	github: GitHubClient;
	forkOwner: string;
}

export async function recordConsensus(
	db: FairygitMotherDb,
	submissionId: string,
	outcome: "approved" | "rejected" | "timeout",
	prContext?: PrSubmitContext,
) {
	// Idempotency guard: skip if consensus already recorded for this submission
	const existing = (
		await db
			.select({ id: consensusResults.id })
			.from(consensusResults)
			.where(eq(consensusResults.submissionId, submissionId))
	)[0];
	if (existing) return existing.id;

	const allVotes = await db.select().from(votes).where(eq(votes.submissionId, submissionId));

	const approvals = allVotes.filter((v) => v.decision === "approve").length;
	const rejections = allVotes.filter((v) => v.decision === "reject").length;

	const resultId = generateId("cons");
	await db.insert(consensusResults).values({
		id: resultId,
		submissionId,
		outcome,
		approveCount: approvals,
		rejectCount: rejections,
		totalVotes: allVotes.length,
	});

	// Update bounty status
	const submission = (
		await db.select().from(submissions).where(eq(submissions.id, submissionId))
	)[0];

	if (submission) {
		const bounty = (
			await db.select().from(bounties).where(eq(bounties.id, submission.bountyId))
		)[0];

		if (outcome === "approved") {
			await db
				.update(bounties)
				.set({ status: "approved", updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, submission.bountyId));

			await db
				.update(nodes)
				.set({
					totalBountiesSolved: sql`${nodes.totalBountiesSolved} + 1`,
				})
				.where(eq(nodes.id, submission.nodeId));
		} else {
			// Rejection: store feedback on bounty and requeue for another solver to try
			const MAX_SUBMISSIONS = 3;
			const rejectionReasons = allVotes
				.filter((v) => v.decision === "reject")
				.map((v) => ({ reasoning: v.reasoning, issuesFound: v.issuesFound }));

			if (bounty && bounty.submissionCount < MAX_SUBMISSIONS) {
				// Requeue with feedback — any solver that picks it up sees what went wrong
				await db
					.update(bounties)
					.set({
						status: "queued",
						assignedNodeId: null,
						lastRejectionReasons: rejectionReasons,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(bounties.id, submission.bountyId));

				// Also push feedback to the original solver if connected
				pushToNode(submission.nodeId, {
					type: "rejection_feedback",
					bountyId: submission.bountyId,
					submissionId,
					attemptsRemaining: MAX_SUBMISSIONS - bounty.submissionCount,
					reasons: rejectionReasons,
				});
			} else {
				// Max attempts exhausted — terminal rejection
				await db
					.update(bounties)
					.set({
						status: "rejected",
						lastRejectionReasons: rejectionReasons,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(bounties.id, submission.bountyId));
			}
		}

		// Reward accurate reviewers
		for (const vote of allVotes) {
			const accurate =
				(outcome === "approved" && vote.decision === "approve") ||
				(outcome === "rejected" && vote.decision === "reject");
			await applyReputationEvent(
				db,
				vote.reviewerNodeId,
				accurate ? "review_accurate" : "review_inaccurate",
			);
		}

		emitEvent({ type: "consensus_reached", submissionId, outcome });
		await logAudit(db, "consensus_reached", submissionId, {
			outcome,
			approveCount: approvals,
			rejectCount: rejections,
			totalVotes: allVotes.length,
		});

		// Auto-submit PR on approval (fire-and-forget, errors logged not thrown)
		if (outcome === "approved" && prContext) {
			submitPr(db, prContext.github, submissionId, prContext.forkOwner).catch(async (err) => {
				console.error(`[consensus] Failed to auto-submit PR for ${submissionId}:`, err);
				await logAudit(db, "pr_submitted", submissionId, {
					error: String(err),
					bountyId: submission.bountyId,
				});
			});
		}
	}

	return resultId;
}
