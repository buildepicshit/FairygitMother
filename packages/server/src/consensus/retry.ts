import type { GitHubClient } from "@fairygitmother/core";
import { and, eq, sql } from "drizzle-orm";
import { logAudit } from "../audit.js";
import type { FairygitMotherDb } from "../db/client.js";
import { bounties, consensusResults, submissions } from "../db/schema.js";
import { submitPr } from "./submitter.js";

/**
 * Find bounties stuck in `approved` status with no PR submitted,
 * and retry the PR submission. This recovers from transient GitHub API
 * failures, rate limits, or server crashes during submitPr.
 *
 * Only retries bounties approved >5 minutes ago (gives the initial
 * fire-and-forget a chance to complete).
 */
export async function retryApprovedPrs(
	db: FairygitMotherDb,
	github: GitHubClient,
	forkOwner: string,
): Promise<number> {
	const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

	// Find approved bounties with no pr_url in consensus results
	const stuck = await db
		.select({ bountyId: bounties.id })
		.from(bounties)
		.innerJoin(submissions, eq(submissions.bountyId, bounties.id))
		.innerJoin(consensusResults, eq(consensusResults.submissionId, submissions.id))
		.where(
			and(
				eq(bounties.status, "approved"),
				eq(consensusResults.outcome, "approved"),
				sql`${consensusResults.prUrl} IS NULL`,
				sql`${consensusResults.decidedAt} < ${fiveMinAgo}`,
			),
		)
		.limit(5);

	let retried = 0;

	for (const row of stuck) {
		// Find the submission for this bounty
		const submission = (
			await db.select().from(submissions).where(eq(submissions.bountyId, row.bountyId))
		)[0];
		if (!submission) continue;

		try {
			const result = await submitPr(db, github, submission.id, forkOwner);
			if (result) {
				retried++;
				await logAudit(db, "pr_retry_success", submission.id, {
					bountyId: row.bountyId,
					prUrl: result.prUrl,
				});
			}
		} catch (err) {
			console.error(`[retry] Failed to retry PR for bounty ${row.bountyId}:`, err);
			await logAudit(db, "pr_retry_failed", submission.id, {
				bountyId: row.bountyId,
				error: String(err),
			});
		}
	}

	return retried;
}
