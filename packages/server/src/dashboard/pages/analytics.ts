import { eq, sql } from "drizzle-orm";
import { html } from "hono/html";
import type { FairygitMotherDb } from "../../db/client.js";
import { bounties, submissions } from "../../db/schema.js";
import { formatNumber } from "../utils.js";

interface ModelStat {
	modelId: string;
	totalSubmissions: number;
	approved: number;
	merged: number;
	rejected: number;
	avgSolveTimeMs: number;
	totalTokens: number;
}

export async function analyticsPage(db: FairygitMotherDb) {
	const modelStats: ModelStat[] = await db
		.select({
			modelId: submissions.modelId,
			totalSubmissions: sql<number>`count(*)::int`,
			approved: sql<number>`count(case when ${bounties.status} in ('approved', 'pr_submitted', 'pr_merged') then 1 end)::int`,
			merged: sql<number>`count(case when ${bounties.status} = 'pr_merged' then 1 end)::int`,
			rejected: sql<number>`count(case when ${bounties.status} in ('rejected', 'pr_closed') then 1 end)::int`,
			avgSolveTimeMs: sql<number>`coalesce(avg(${submissions.solveDurationMs}), 0)::int`,
			totalTokens: sql<number>`coalesce(sum(${submissions.tokensUsed}), 0)::int`,
		})
		.from(submissions)
		.innerJoin(bounties, eq(submissions.bountyId, bounties.id))
		.where(sql`${submissions.modelId} is not null`)
		.groupBy(submissions.modelId)
		.orderBy(sql`count(case when ${bounties.status} = 'pr_merged' then 1 end) desc`);

	// Overall pipeline stats
	const totalSubs = modelStats.reduce((s, m) => s + m.totalSubmissions, 0);
	const totalApproved = modelStats.reduce((s, m) => s + m.approved, 0);
	const totalMerged = modelStats.reduce((s, m) => s + m.merged, 0);
	const totalRejected = modelStats.reduce((s, m) => s + m.rejected, 0);
	const totalTokens = modelStats.reduce((s, m) => s + m.totalTokens, 0);

	const overallSolveRate = totalSubs > 0 ? Math.round((totalApproved / totalSubs) * 100) : 0;
	const overallMergeRate = totalApproved > 0 ? Math.round((totalMerged / totalApproved) * 100) : 0;

	if (modelStats.length === 0) {
		return html`
			<div class="section-header">
				<h1>Analytics</h1>
			</div>
			<div class="empty-state">No model data yet. Submissions with modelId will appear here.</div>`;
	}

	const maxSubs = Math.max(...modelStats.map((m) => m.totalSubmissions));

	return html`
		<div class="section-header">
			<h1>Analytics</h1>
			<span class="count">${modelStats.length} models tracked</span>
		</div>

		<section class="stats-grid">
			<div class="stat-card">
				<span class="stat-value">${totalSubs}</span>
				<span class="stat-label">Total Submissions</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${overallSolveRate}%</span>
				<span class="stat-label">Consensus Rate</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${overallMergeRate}%</span>
				<span class="stat-label">Merge Rate</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${totalRejected}</span>
				<span class="stat-label">Rejected</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${formatNumber(totalTokens)}</span>
				<span class="stat-label">Tokens Used</span>
			</div>
		</section>

		<section class="analytics-grid">
			<div class="analytics-card">
				<h3>Submissions by Model</h3>
				<div class="bar-chart">
					${modelStats.map(
						(m) => html`
					<div class="bar-row">
						<span class="bar-label">${m.modelId}</span>
						<div class="bar-track">
							<div class="bar-fill bar-fill-green" style="width: ${Math.round((m.totalSubmissions / maxSubs) * 100)}%"></div>
						</div>
						<span class="bar-value">${m.totalSubmissions}</span>
					</div>`,
					)}
				</div>
			</div>

			<div class="analytics-card">
				<h3>Solve Rate by Model</h3>
				<div class="bar-chart">
					${modelStats.map((m) => {
						const rate =
							m.totalSubmissions > 0 ? Math.round((m.approved / m.totalSubmissions) * 100) : 0;
						return html`
					<div class="bar-row">
						<span class="bar-label">${m.modelId}</span>
						<div class="bar-track">
							<div class="bar-fill bar-fill-teal" style="width: ${rate}%"></div>
						</div>
						<span class="bar-value">${rate}%</span>
					</div>`;
					})}
				</div>
			</div>
		</section>

		<section>
			<h2>Model Performance</h2>
			<div class="table-wrap model-table">
				<table>
					<thead>
						<tr>
							<th>Model</th>
							<th>Submissions</th>
							<th>Approved</th>
							<th>Merged</th>
							<th>Rejected</th>
							<th>Solve Rate</th>
							<th>Merge Rate</th>
							<th>Avg Time</th>
							<th>Tokens</th>
						</tr>
					</thead>
					<tbody>${modelStats.map((m) => {
						const solveRate =
							m.totalSubmissions > 0 ? Math.round((m.approved / m.totalSubmissions) * 100) : 0;
						const mergeRate = m.approved > 0 ? Math.round((m.merged / m.approved) * 100) : 0;
						return html`
						<tr>
							<td>${m.modelId}</td>
							<td>${m.totalSubmissions}</td>
							<td>${m.approved}</td>
							<td>${m.merged}</td>
							<td>${m.rejected}</td>
							<td class="solve-rate">${solveRate}%</td>
							<td class="merge-rate">${mergeRate}%</td>
							<td>${m.avgSolveTimeMs > 0 ? `${Math.round(m.avgSolveTimeMs / 1000)}s` : "—"}</td>
							<td>${formatNumber(m.totalTokens)}</td>
						</tr>`;
					})}</tbody>
				</table>
			</div>
		</section>`;
}
