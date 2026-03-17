import { type GitHubClient, generateId } from "@fairygitmother/core";
import { eq, sql } from "drizzle-orm";
import { emitEvent } from "../api/feed.js";
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
		const newStatus = outcome === "approved" ? "approved" : "rejected";
		await db
			.update(bounties)
			.set({ status: newStatus, updatedAt: new Date().toISOString() })
			.where(eq(bounties.id, submission.bountyId));

		// Apply reputation events
		// Note: fix_merged/fix_closed reputation is applied in cleanup.ts when
		// the actual GitHub PR is confirmed merged/closed — not here at consensus time.
		if (outcome === "approved") {
			await db
				.update(nodes)
				.set({
					totalBountiesSolved: sql`${nodes.totalBountiesSolved} + 1`,
				})
				.where(eq(nodes.id, submission.nodeId));
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
