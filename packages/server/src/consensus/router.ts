import { and, eq, ne } from "drizzle-orm";
import type { FairygitMotherDb } from "../db/client.js";
import { nodes, submissions, votes } from "../db/schema.js";
import { getConsensusRequirement } from "../orchestrator/reputation.js";

export interface ReviewAssignment {
	reviewerNodeId: string;
	submissionId: string;
}

export function assignReviewers(db: FairygitMotherDb, submissionId: string): ReviewAssignment[] {
	const submission = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();
	if (!submission) return [];

	const requiredVotes = getConsensusRequirement(db, submission.nodeId);

	// Find idle nodes that aren't the solver
	const candidates = db
		.select()
		.from(nodes)
		.where(and(eq(nodes.status, "idle"), ne(nodes.id, submission.nodeId)))
		.all();

	// Filter out nodes that have already voted on this submission
	const existingVotes = db.select().from(votes).where(eq(votes.submissionId, submissionId)).all();
	const alreadyVoted = new Set(existingVotes.map((v) => v.reviewerNodeId));

	const eligible = candidates
		.filter((n) => !alreadyVoted.has(n.id))
		.filter((n) => n.reputationScore >= 20) // New nodes can't review
		.sort((a, b) => b.reputationScore - a.reputationScore);

	// Assign up to requiredVotes + 1 reviewers (one extra for redundancy)
	const assignCount = Math.min(eligible.length, requiredVotes + 1);
	return eligible.slice(0, assignCount).map((node) => ({
		reviewerNodeId: node.id,
		submissionId,
	}));
}

export function getReviewersNeeded(db: FairygitMotherDb, submissionId: string): number {
	const submission = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();
	if (!submission) return 3;

	const required = getConsensusRequirement(db, submission.nodeId);

	const existingVotes = db.select().from(votes).where(eq(votes.submissionId, submissionId)).all();

	return Math.max(0, required - existingVotes.length);
}
