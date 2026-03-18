import { desc } from "drizzle-orm";
import { html } from "hono/html";
import type { FairygitMotherDb } from "../../db/client.js";
import { bounties } from "../../db/schema.js";

export async function bountiesPage(db: FairygitMotherDb) {
	const allBounties = await db.select().from(bounties).orderBy(desc(bounties.createdAt)).limit(50);

	if (allBounties.length === 0) {
		return html`
			<div class="section-header">
				<h1>Bounty Board</h1>
			</div>
			<div class="empty-state">No bounties yet. Submit an issue to get started.</div>`;
	}

	return html`
		<div class="section-header">
			<h1>Bounty Board</h1>
			<span class="count">${allBounties.length} bounties</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Issue</th>
						<th>Title</th>
						<th>Language</th>
						<th>Status</th>
						<th>Complexity</th>
						<th>Retries</th>
					</tr>
				</thead>
				<tbody>${allBounties.map(
					(b) => html`
					<tr>
						<td><a href="https://github.com/${b.owner}/${b.repo}/issues/${b.issueNumber}" target="_blank">${b.owner}/${b.repo}#${b.issueNumber}</a></td>
						<td>${b.issueTitle}</td>
						<td>${b.language ?? "—"}</td>
						<td><span class="status status-${b.status}">${b.status}</span></td>
						<td>${b.complexityEstimate}/5</td>
						<td>${b.retryCount > 0 ? b.retryCount : "—"}</td>
					</tr>`,
				)}</tbody>
			</table>
		</div>`;
}
