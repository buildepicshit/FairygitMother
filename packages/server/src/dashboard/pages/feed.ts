import { desc, inArray } from "drizzle-orm";
import { html } from "hono/html";
import type { FairygitMotherDb } from "../../db/client.js";
import { bounties, consensusResults, submissions } from "../../db/schema.js";
import { formatRelativeTime } from "../utils.js";

export async function feedPage(db: FairygitMotherDb) {
	const recent = await db
		.select()
		.from(consensusResults)
		.orderBy(desc(consensusResults.decidedAt))
		.limit(20);

	if (recent.length === 0) {
		return html`
			<div class="section-header">
				<h1>Feed</h1>
			</div>
			<div class="empty-state">No consensus activity yet.</div>`;
	}

	// Resolve bounty context for display
	const submissionIds = recent.map((r) => r.submissionId);
	const subs = await db.select().from(submissions).where(inArray(submissions.id, submissionIds));

	const bountyIds = [...new Set(subs.map((s) => s.bountyId))];
	const bountyRows =
		bountyIds.length > 0
			? await db.select().from(bounties).where(inArray(bounties.id, bountyIds))
			: [];

	const subMap = new Map(subs.map((s) => [s.id, s]));
	const bountyMap = new Map(bountyRows.map((b) => [b.id, b]));

	return html`
		<div class="section-header">
			<h1>Feed</h1>
			<span class="count">${recent.length} recent decisions</span>
		</div>
		<div class="feed">${recent.map((r) => {
			const sub = subMap.get(r.submissionId);
			const bounty = sub ? bountyMap.get(sub.bountyId) : null;
			const issueRef = bounty ? `${bounty.owner}/${bounty.repo}#${bounty.issueNumber}` : "";

			return html`
			<div class="feed-item">
				<span class="status status-${r.outcome}">${r.outcome}</span>
				<span>${r.approveCount}/${r.totalVotes} approved</span>
				${bounty ? html`<span class="feed-issue">${issueRef}</span>` : ""}
				<div class="feed-meta">
					${r.prUrl ? html`<a href="${r.prUrl}" target="_blank">View PR</a>` : ""}
					<time>${formatRelativeTime(r.decidedAt)}</time>
				</div>
			</div>`;
		})}</div>`;
}
