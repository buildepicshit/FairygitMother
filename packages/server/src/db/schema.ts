import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const repos = sqliteTable("repos", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	owner: text("owner").notNull(),
	name: text("name").notNull(),
	language: text("language"),
	optInTier: text("opt_in_tier").notNull().default("label"), // explicit | label | global
	blacklisted: integer("blacklisted", { mode: "boolean" }).notNull().default(false),
	consecutiveRejects: integer("consecutive_rejects").notNull().default(0),
	totalPrsMerged: integer("total_prs_merged").notNull().default(0),
	totalPrsClosed: integer("total_prs_closed").notNull().default(0),
	lastTrawledAt: text("last_trawled_at"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const bounties = sqliteTable("bounties", {
	id: text("id").primaryKey(),
	repoId: integer("repo_id").references(() => repos.id),
	owner: text("owner").notNull(),
	repo: text("repo").notNull(),
	issueNumber: integer("issue_number").notNull(),
	issueTitle: text("issue_title").notNull(),
	issueBody: text("issue_body").notNull(),
	labels: text("labels", { mode: "json" }).$type<string[]>().notNull().default([]),
	language: text("language"),
	complexityEstimate: integer("complexity_estimate").notNull().default(3),
	status: text("status").notNull().default("queued"),
	assignedNodeId: text("assigned_node_id"),
	priority: integer("priority").notNull().default(50),
	retryCount: integer("retry_count").notNull().default(0),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updated_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const nodes = sqliteTable("nodes", {
	id: text("id").primaryKey(),
	displayName: text("display_name"),
	apiKey: text("api_key").notNull().unique(),
	capabilities: text("capabilities", { mode: "json" })
		.$type<{ languages: string[]; tools: string[] }>()
		.notNull(),
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

export const submissions = sqliteTable("submissions", {
	id: text("id").primaryKey(),
	bountyId: text("bounty_id")
		.notNull()
		.references(() => bounties.id),
	nodeId: text("node_id")
		.notNull()
		.references(() => nodes.id),
	diff: text("diff").notNull(),
	explanation: text("explanation").notNull(),
	filesChanged: text("files_changed", { mode: "json" }).$type<string[]>().notNull(),
	testsPassed: integer("tests_passed", { mode: "boolean" }),
	tokensUsed: integer("tokens_used"),
	solverBackend: text("solver_backend").notNull(),
	solveDurationMs: integer("solve_duration_ms").notNull(),
	submittedAt: text("submitted_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const votes = sqliteTable("votes", {
	id: text("id").primaryKey(),
	submissionId: text("submission_id")
		.notNull()
		.references(() => submissions.id),
	reviewerNodeId: text("reviewer_node_id")
		.notNull()
		.references(() => nodes.id),
	decision: text("decision").notNull(), // approve | reject
	reasoning: text("reasoning").notNull(),
	issuesFound: text("issues_found", { mode: "json" }).$type<string[]>().notNull().default([]),
	confidence: real("confidence").notNull(),
	testsRun: integer("tests_run", { mode: "boolean" }).notNull().default(false),
	votedAt: text("voted_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const consensusResults = sqliteTable("consensus_results", {
	id: text("id").primaryKey(),
	submissionId: text("submission_id")
		.notNull()
		.references(() => submissions.id),
	outcome: text("outcome").notNull(), // approved | rejected | timeout
	approveCount: integer("approve_count").notNull().default(0),
	rejectCount: integer("reject_count").notNull().default(0),
	totalVotes: integer("total_votes").notNull().default(0),
	prUrl: text("pr_url"),
	decidedAt: text("decided_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const auditLog = sqliteTable("audit_log", {
	id: text("id").primaryKey(),
	event: text("event").notNull(),
	entityId: text("entity_id").notNull(),
	details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
	timestamp: text("timestamp")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});
