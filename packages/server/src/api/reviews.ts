import { SubmitVoteRequestSchema, generateId } from "@fairygitmother/core";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { logAudit } from "../audit.js";
import {
	type PrSubmitContext,
	evaluateConsensus,
	recordConsensus,
} from "../consensus/aggregator.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, nodes, submissions, votes } from "../db/schema.js";

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
		const submission = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();
		if (!submission) {
			return c.json({ error: "Submission not found" }, 404);
		}

		// Can't review your own submission
		if (submission.nodeId === reviewerNodeId) {
			return c.json({ error: "Cannot review your own submission" }, 403);
		}

		// Transition bounty to in_review on first vote
		const bounty = db.select().from(bounties).where(eq(bounties.id, submission.bountyId)).get();
		if (bounty?.status === "diff_submitted") {
			db.update(bounties)
				.set({ status: "in_review", updatedAt: new Date().toISOString() })
				.where(eq(bounties.id, submission.bountyId))
				.run();
		}

		const voteId = generateId("vote");
		db.insert(votes)
			.values({
				id: voteId,
				submissionId,
				reviewerNodeId,
				decision: parsed.data.decision,
				reasoning: parsed.data.reasoning,
				issuesFound: parsed.data.issuesFound,
				confidence: parsed.data.confidence,
				testsRun: parsed.data.testsRun,
			})
			.run();

		logAudit(db, "review_voted", voteId, {
			submissionId,
			reviewerNodeId,
			decision: parsed.data.decision,
		});

		// Update reviewer stats
		db.update(nodes)
			.set({
				totalReviewsDone: sql`${nodes.totalReviewsDone} + 1`,
			})
			.where(eq(nodes.id, reviewerNodeId))
			.run();

		// Check if consensus is reached
		const decision = evaluateConsensus(db, submissionId);
		if (decision !== "pending") {
			recordConsensus(db, submissionId, decision, prContext);
		}

		return c.json({ accepted: true, consensusStatus: decision });
	});

	return app;
}
