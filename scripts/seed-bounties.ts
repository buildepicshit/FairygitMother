import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../packages/server/src/db/schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL required");
	process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 5 });
const db = drizzle(pool, { schema });

// Verify DB is clean
const bountyCount = await db.select().from(schema.bounties);
const nodeCount = await db.select().from(schema.nodes);
console.log(`Current state: ${bountyCount.length} bounties, ${nodeCount.length} nodes`);

// Curated: diverse repos, diverse languages, complexity 1-2, real bugs
const issues = [
	{
		owner: "jganoff",
		repo: "wsp",
		issueNumber: 22,
		issueTitle: "test: UpstreamRef::Head with local-only commits silently reports zero ahead",
		issueBody:
			"UpstreamRef::Head with local-only commits silently reports zero ahead. Need test coverage for this edge case.",
		labels: ["bug", "good first issue", "test-coverage"],
		language: "Rust",
		complexity: 1,
	},
	{
		owner: "surge-downloader",
		repo: "Surge",
		issueNumber: 242,
		issueTitle: "For binaries downloaded directly via go install version is vdev",
		issueBody:
			"When installing via go install, the version string is vdev instead of the actual release version. The ldflags are not set during go install.",
		labels: ["bug", "good first issue"],
		language: "Go",
		complexity: 1,
	},
	{
		owner: "seszele64",
		repo: "blix-scraper",
		issueNumber: 15,
		issueTitle: "Config: Type coercion bypassed for nested settings when using .env file",
		issueBody:
			"Type coercion is bypassed for nested settings when using .env file. Settings loaded from .env are not properly coerced to their expected types.",
		labels: ["bug", "good first issue", "technical-debt"],
		language: "Python",
		complexity: 2,
	},
	{
		owner: "finos",
		repo: "FDC3",
		issueNumber: 1795,
		issueTitle: "FDC3 reference implementation (demo) reports incorrect ImplementationMetadata",
		issueBody:
			"The FDC3 reference implementation demo reports incorrect ImplementationMetadata. The metadata does not match the actual implementation details.",
		labels: ["bug", "good first issue"],
		language: "TypeScript",
		complexity: 2,
	},
	{
		owner: "nextcloud",
		repo: "approval",
		issueNumber: 398,
		issueTitle: "API allows rerequesting approval of approved files",
		issueBody:
			"The API currently allows rerequesting approval on files that have already been approved. This should be prevented.",
		labels: ["bug", "good first issue"],
		language: "PHP",
		complexity: 2,
	},
	{
		owner: "qutip",
		repo: "qutip-qip",
		issueNumber: 340,
		issueTitle: "Bug in circuit plotting: showarg argument is not working",
		issueBody:
			"The showarg argument in circuit plotting is not working. When showarg is set, the arguments are not displayed on the circuit diagram.",
		labels: ["bug", "good first issue"],
		language: "Python",
		complexity: 1,
	},
];

function generateId(prefix: string) {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return `${prefix}_${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}

for (const issue of issues) {
	const bountyId = generateId("bty");
	await db.insert(schema.bounties).values({
		id: bountyId,
		owner: issue.owner,
		repo: issue.repo,
		issueNumber: issue.issueNumber,
		issueTitle: issue.issueTitle,
		issueBody: issue.issueBody,
		labels: issue.labels,
		language: issue.language,
		complexityEstimate: issue.complexity,
		status: "queued",
		priority: 50,
		retryCount: 0,
	});

	// Ensure repo exists
	const existing = await db
		.select()
		.from(schema.repos)
		.where(and(eq(schema.repos.owner, issue.owner), eq(schema.repos.name, issue.repo)));

	if (existing.length === 0) {
		await db.insert(schema.repos).values({
			owner: issue.owner,
			name: issue.repo,
			language: issue.language,
			optInTier: "explicit",
		});
	}

	console.log(
		`  Queued: ${issue.owner}/${issue.repo}#${issue.issueNumber} — ${issue.issueTitle} [${issue.language}, C${issue.complexity}]`,
	);
}

const final = await db.select().from(schema.bounties);
console.log(`\nBounty board: ${final.length} bounties queued`);
await pool.end();
