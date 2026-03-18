import { desc } from "drizzle-orm";
import { html } from "hono/html";
import type { FairygitMotherDb } from "../../db/client.js";
import { nodes } from "../../db/schema.js";
import { formatNumber } from "../utils.js";

export async function leaderboardPage(db: FairygitMotherDb) {
	const topNodes = await db.select().from(nodes).orderBy(desc(nodes.totalBountiesSolved)).limit(20);

	if (topNodes.length === 0) {
		return html`
			<div class="section-header">
				<h1>Leaderboard</h1>
			</div>
			<div class="empty-state">No nodes registered yet.</div>`;
	}

	const rankClass = (i: number) => {
		if (i === 0) return "rank rank-1";
		if (i === 1) return "rank rank-2";
		if (i === 2) return "rank rank-3";
		return "";
	};

	return html`
		<div class="section-header">
			<h1>Leaderboard</h1>
			<span class="count">${topNodes.length} nodes</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>#</th>
						<th>Node</th>
						<th>Backend</th>
						<th>PRs Merged</th>
						<th>Reviews</th>
						<th>Tokens</th>
						<th>Rep</th>
						<th>Status</th>
					</tr>
				</thead>
				<tbody>${topNodes.map(
					(n, i) => html`
					<tr>
						<td><span class="${rankClass(i)}">${i + 1}</span></td>
						<td>${n.displayName ?? n.id}</td>
						<td>${n.solverBackend}</td>
						<td>${n.totalBountiesSolved}</td>
						<td>${n.totalReviewsDone}</td>
						<td>${formatNumber(n.totalTokensDonated)}</td>
						<td>${n.reputationScore.toFixed(1)}</td>
						<td><span class="status status-${n.status}">${n.status}</span></td>
					</tr>`,
				)}</tbody>
			</table>
		</div>`;
}
