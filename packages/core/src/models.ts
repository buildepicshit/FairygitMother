import { z } from "zod";

// ── Bounty Status ──────────────────────────────────────────────

export const BountyStatusSchema = z.enum([
	"queued",
	"assigned",
	"in_progress",
	"diff_submitted",
	"in_review",
	"approved",
	"rejected",
	"pr_submitted",
]);
export type BountyStatus = z.infer<typeof BountyStatusSchema>;

// ── Bounty ─────────────────────────────────────────────────────

export const BountySchema = z.object({
	id: z.string(),
	repoUrl: z.string().url(),
	owner: z.string(),
	repo: z.string(),
	issueNumber: z.number().int().positive(),
	issueTitle: z.string(),
	issueBody: z.string(),
	labels: z.array(z.string()),
	language: z.string().nullable(),
	complexityEstimate: z.number().int().min(1).max(5),
	status: BountyStatusSchema,
	assignedNodeId: z.string().nullable(),
	priority: z.number().int(),
	retryCount: z.number().int().min(0),
	createdAt: z.string().datetime(),
});
export type Bounty = z.infer<typeof BountySchema>;

// ── Fix Submission ─────────────────────────────────────────────

export const FixSubmissionSchema = z.object({
	id: z.string(),
	bountyId: z.string(),
	nodeId: z.string(),
	diff: z.string(),
	explanation: z.string(),
	filesChanged: z.array(z.string()),
	testsPassed: z.boolean().nullable(),
	tokensUsed: z.number().int().nullable(),
	solverBackend: z.string(),
	solveDurationMs: z.number().int().min(0),
	submittedAt: z.string().datetime(),
});
export type FixSubmission = z.infer<typeof FixSubmissionSchema>;

// ── Review Vote ────────────────────────────────────────────────

export const VoteDecisionSchema = z.enum(["approve", "reject"]);
export type VoteDecision = z.infer<typeof VoteDecisionSchema>;

export const ReviewVoteSchema = z.object({
	id: z.string(),
	submissionId: z.string(),
	reviewerNodeId: z.string(),
	decision: VoteDecisionSchema,
	reasoning: z.string(),
	issuesFound: z.array(z.string()),
	confidence: z.number().min(0).max(1),
	testsRun: z.boolean(),
	votedAt: z.string().datetime(),
});
export type ReviewVote = z.infer<typeof ReviewVoteSchema>;

// ── Node Registration ──────────────────────────────────────────

export const NodeStatusSchema = z.enum(["offline", "idle", "busy", "reviewing"]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeCapabilitiesSchema = z.object({
	languages: z.array(z.string()),
	tools: z.array(z.string()),
});
export type NodeCapabilities = z.infer<typeof NodeCapabilitiesSchema>;

export const NodeRegistrationSchema = z.object({
	id: z.string(),
	displayName: z.string().nullable(),
	capabilities: NodeCapabilitiesSchema,
	solverBackend: z.string(),
	status: NodeStatusSchema,
	reputationScore: z.number().min(0).max(100),
	totalTokensDonated: z.number().int().min(0),
	registeredAt: z.string().datetime(),
	lastHeartbeat: z.string().datetime(),
});
export type NodeRegistration = z.infer<typeof NodeRegistrationSchema>;

// ── Consensus Result ───────────────────────────────────────────

export const ConsensusOutcomeSchema = z.enum(["approved", "rejected", "timeout"]);
export type ConsensusOutcome = z.infer<typeof ConsensusOutcomeSchema>;

export const ConsensusResultSchema = z.object({
	id: z.string(),
	submissionId: z.string(),
	outcome: ConsensusOutcomeSchema,
	approveCount: z.number().int().min(0),
	rejectCount: z.number().int().min(0),
	totalVotes: z.number().int().min(0),
	decidedAt: z.string().datetime(),
});
export type ConsensusResult = z.infer<typeof ConsensusResultSchema>;

// ── Repo Config (.fairygitmother.yml) ──────────────────────────

export const RepoConfigSchema = z.object({
	enabled: z.boolean().default(true),
	labels: z.array(z.string()).default(["good first issue", "help wanted"]),
	maxPrsPerDay: z.number().int().min(1).default(2),
	allowedPaths: z.array(z.string()).optional(),
	excludedPaths: z.array(z.string()).optional(),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ── Audit Log ──────────────────────────────────────────────────

export const AuditEventSchema = z.enum([
	"bounty_created",
	"bounty_assigned",
	"fix_submitted",
	"review_voted",
	"consensus_reached",
	"pr_submitted",
	"pr_merged",
	"pr_closed",
	"node_registered",
	"node_pruned",
	"repo_blacklisted",
]);
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditLogEntrySchema = z.object({
	id: z.string(),
	event: AuditEventSchema,
	entityId: z.string(),
	details: z.record(z.unknown()).nullable(),
	timestamp: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
