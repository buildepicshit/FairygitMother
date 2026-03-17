import {
	boolean,
	integer,
	jsonb,
	pgTable,
	real,
	serial,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const repos = pgTable("repos", {
	id: serial("id").primaryKey(),
	owner: text("owner").notNull(),
	name: text("name").notNull(),
	language: text("language"),
	optInTier: text("opt_in_tier").notNull().default("label"),
	blacklisted: boolean("blacklisted").notNull().default(false),
	consecutiveRejects: integer("consecutive_rejects").notNull().default(0),
	totalPrsMerged: integer("total_prs_merged").notNull().default(0),
	totalPrsClosed: integer("total_prs_closed").notNull().default(0),
	lastTrawledAt: text("last_trawled_at"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const bounties = pgTable("bounties", {
	id: text("id").primaryKey(),
	repoId: integer("repo_id").references(() => repos.id),
	owner: text("owner").notNull(),
	repo: text("repo").notNull(),
	issueNumber: integer("issue_number").notNull(),
	issueTitle: text("issue_title").notNull(),
	issueBody: text("issue_body").notNull().default(""),
	labels: jsonb("labels").$type<string[]>().notNull().default([]),
	language: text("language"),
	complexityEstimate: integer("complexity_estimate").notNull().default(3),
	status: text("status").notNull().default("queued"),
	assignedNodeId: text("assigned_node_id"),
	priority: integer("priority").notNull().default(50),
	retryCount: integer("retry_count").notNull().default(0),
	submissionCount: integer("submission_count").notNull().default(0),
	lastRejectionReasons:
		jsonb("last_rejection_reasons").$type<Array<{ reasoning: string; issuesFound: string[] }>>(),
	fileContext: jsonb("file_context").$type<Array<{ path: string; content: string }>>(),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updated_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const nodes = pgTable("nodes", {
	id: text("id").primaryKey(),
	displayName: text("display_name"),
	apiKey: text("api_key").notNull().unique(),
	capabilities: jsonb("capabilities").$type<{ languages: string[]; tools: string[] }>().notNull(),
	solverBackend: text("solver_backend").notNull(),
	status: text("status").notNull().default("idle"),
	reputationScore: real("reputation_score").notNull().default(50),
	totalTokensDonated: integer("total_tokens_donated").notNull().default(0),
	totalBountiesSolved: integer("total_bounties_solved").notNull().default(0),
	totalReviewsDone: integer("total_reviews_done").notNull().default(0),
	registeredAt: text("registered_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	lastHeartbeat: text("last_heartbeat")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const submissions = pgTable("submissions", {
	id: text("id").primaryKey(),
	bountyId: text("bounty_id")
		.notNull()
		.references(() => bounties.id),
	nodeId: text("node_id")
		.notNull()
		.references(() => nodes.id),
	diff: text("diff").notNull(),
	explanation: text("explanation").notNull(),
	filesChanged: jsonb("files_changed").$type<string[]>().notNull(),
	testsPassed: boolean("tests_passed"),
	tokensUsed: integer("tokens_used"),
	solverBackend: text("solver_backend").notNull(),
	modelId: text("model_id"),
	solveDurationMs: integer("solve_duration_ms").notNull(),
	submittedAt: text("submitted_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const votes = pgTable(
	"votes",
	{
		id: text("id").primaryKey(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id),
		reviewerNodeId: text("reviewer_node_id")
			.notNull()
			.references(() => nodes.id),
		decision: text("decision").notNull(),
		reasoning: text("reasoning").notNull(),
		issuesFound: jsonb("issues_found").$type<string[]>().notNull().default([]),
		confidence: real("confidence").notNull(),
		testsRun: boolean("tests_run").notNull().default(false),
		votedAt: text("voted_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => [
		uniqueIndex("uq_votes_submission_reviewer").on(table.submissionId, table.reviewerNodeId),
	],
);

export const consensusResults = pgTable("consensus_results", {
	id: text("id").primaryKey(),
	submissionId: text("submission_id")
		.notNull()
		.unique()
		.references(() => submissions.id),
	outcome: text("outcome").notNull(),
	approveCount: integer("approve_count").notNull().default(0),
	rejectCount: integer("reject_count").notNull().default(0),
	totalVotes: integer("total_votes").notNull().default(0),
	prUrl: text("pr_url"),
	decidedAt: text("decided_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const auditLog = pgTable("audit_log", {
	id: text("id").primaryKey(),
	event: text("event").notNull(),
	entityId: text("entity_id").notNull(),
	details: jsonb("details").$type<Record<string, unknown>>(),
	timestamp: text("timestamp")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});
