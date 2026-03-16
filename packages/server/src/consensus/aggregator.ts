import { generateId } from "@fairygitmother/core";
import { eq, sql } from "drizzle-orm";
import { emitEvent } from "../api/feed.js";
import { logAudit } from "../audit.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes, submissions, votes } from "../db/schema.js";
import { applyReputationEvent, getConsensusRequirement } from "../orchestrator/reputation.js";

export type ConsensusDecision = "approved" | "rejected" | "pending" | "timeout";

export function evaluateConsensus(db: FairygitMotherDb, submissionId: string): ConsensusDecision {
	const submission = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();
	if (!submission) return "pending";

	const allVotes = db.select().from(votes).where(eq(votes.submissionId, submissionId)).all();

	const required = getConsensusRequirement(db, submission.nodeId);
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

export function recordConsensus(
	db: FairygitMotherDb,
	submissionId: string,
	outcome: "approved" | "rejected" | "timeout",
) {
	const allVotes = db.select().from(votes).where(eq(votes.submissionId, submissionId)).all();

	const approvals = allVotes.filter((v) => v.decision === "approve").length;
	const rejections = allVotes.filter((v) => v.decision === "reject").length;

	const resultId = generateId("cons");
	db.insert(consensusResults)
		.values({
			id: resultId,
			submissionId,
			outcome,
			approveCount: approvals,
			rejectCount: rejections,
			totalVotes: allVotes.length,
		})
		.run();

	// Update bounty status
	const submission = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();

	if (submission) {
		const newStatus = outcome === "approved" ? "approved" : "rejected";
		db.update(bounties)
			.set({ status: newStatus, updatedAt: new Date().toISOString() })
			.where(eq(bounties.id, submission.bountyId))
			.run();

		// Apply reputation events
		if (outcome === "approved") {
			applyReputationEvent(db, submission.nodeId, "fix_merged");
			db.update(nodes)
				.set({
					totalBountiesSolved: sql`${nodes.totalBountiesSolved} + 1`,
				})
				.where(eq(nodes.id, submission.nodeId))
				.run();
		} else if (outcome === "rejected") {
			applyReputationEvent(db, submission.nodeId, "fix_closed");
		}

		// Reward accurate reviewers
		for (const vote of allVotes) {
			const accurate =
				(outcome === "approved" && vote.decision === "approve") ||
				(outcome === "rejected" && vote.decision === "reject");
			applyReputationEvent(
				db,
				vote.reviewerNodeId,
				accurate ? "review_accurate" : "review_inaccurate",
			);
		}

		emitEvent({ type: "consensus_reached", submissionId, outcome });
		logAudit(db, "consensus_reached", submissionId, {
			outcome,
			approveCount: approvals,
			rejectCount: rejections,
			totalVotes: allVotes.length,
		});
	}

	return resultId;
}
