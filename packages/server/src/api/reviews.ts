import { SubmitVoteRequestSchema, generateId } from "@fairygitmother/core";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { logAudit } from "../audit.js";
import {
	type PrSubmitContext,
	evaluateConsensus,
	recordConsensus,
} from "../consensus/aggregator.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, nodes, submissions, votes } from "../db/schema.js";

export function createReviewRoutes(db: FairygitMotherDb, prContext?: PrSubmitContext) {
	const app = new Hono();

	// POST /api/v1/reviews/:submissionId/vote
	app.post("/:submissionId/vote", async (c) => {
		const submissionId = c.req.param("submissionId");
		const body = await c.req.json();
		const parsed = SubmitVoteRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
		}

		// Use authenticated node ID as the reviewer
		const reviewerNodeId = c.get("nodeId") as string;

		// Verify submission exists
		const submission = (
			await db.select().from(submissions).where(eq(submissions.id, submissionId))
		)[0];
		if (!submission) {
			return c.json({ error: "Submission not found" }, 404);
		}

		// Can't review your own submission
		if (submission.nodeId === reviewerNodeId) {
			return c.json({ error: "Cannot review your own submission" }, 403);
		}

		// Prevent duplicate votes from the same reviewer
		const existingVote = (
			await db
				.select({ id: votes.id })
				.from(votes)
				.where(and(eq(votes.submissionId, submissionId), eq(votes.reviewerNodeId, reviewerNodeId)))
		)[0];
		if (existingVote) {
			return c.json({ error: "Already voted on this submission" }, 409);
		}

		// Block votes on already-decided submissions
		const existingConsensus = (
			await db
				.select({ id: consensusResults.id })
				.from(consensusResults)
				.where(eq(consensusResults.submissionId, submissionId))
		)[0];
		if (existingConsensus) {
			return c.json({ error: "Consensus already reached for this submission" }, 409);
		}

		// Transition bounty to in_review on first vote
		const bounty = (
			await db.select().from(bounties).where(eq(bounties.id, submission.bountyId))
		)[0];
		if (bounty?.status === "diff_submitted") {
			await db
				.update(bounties)
				.set({ status: "in_review", updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, submission.bountyId));
		}

		const voteId = generateId("vote");
		await db.insert(votes).values({
			id: voteId,
			submissionId,
			reviewerNodeId,
			decision: parsed.data.decision,
			reasoning: parsed.data.reasoning,
			issuesFound: parsed.data.issuesFound,
			confidence: parsed.data.confidence,
			testsRun: parsed.data.testsRun,
		});

		await logAudit(db, "review_voted", voteId, {
			submissionId,
			reviewerNodeId,
			decision: parsed.data.decision,
		});

		// Update reviewer stats
		await db
			.update(nodes)
			.set({
				totalReviewsDone: sql`${nodes.totalReviewsDone} + 1`,
			})
			.where(eq(nodes.id, reviewerNodeId));

		// Check if consensus is reached
		const decision = await evaluateConsensus(db, submissionId);
		if (decision !== "pending") {
			await recordConsensus(db, submissionId, decision, prContext);
		}

		return c.json({ accepted: true, consensusStatus: decision });
	});

	return app;
}
