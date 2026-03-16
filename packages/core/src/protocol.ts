import { z } from "zod";
import {
	BountySchema,
	type FixSubmission,
	NodeCapabilitiesSchema,
	type NodeStatus,
	type ReviewVote,
	VoteDecisionSchema,
} from "./models.js";

// ── Node Registration ──────────────────────────────────────────

export const RegisterNodeRequestSchema = z.object({
	displayName: z.string().nullable().default(null),
	capabilities: NodeCapabilitiesSchema,
	solverBackend: z.string(),
});
export type RegisterNodeRequest = z.infer<typeof RegisterNodeRequestSchema>;

export interface RegisterNodeResponse {
	nodeId: string;
	apiKey: string;
}

// ── Heartbeat ──────────────────────────────────────────────────

export const HeartbeatRequestSchema = z.object({
	status: z.enum(["idle", "busy", "reviewing"]),
	tokensUsedSinceLastHeartbeat: z.number().int().min(0).default(0),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export interface HeartbeatResponse {
	acknowledged: boolean;
	pendingBounty: z.infer<typeof BountySchema> | null;
	pendingReview: PendingReview | null;
}

export interface PendingReview {
	submissionId: string;
	bounty: z.infer<typeof BountySchema>;
	diff: string;
	explanation: string;
}

// ── Bounty Claim ───────────────────────────────────────────────

export interface ClaimBountyResponse {
	bounty: z.infer<typeof BountySchema> | null;
}

// ── Fix Submission ─────────────────────────────────────────────

export const SubmitFixRequestSchema = z.object({
	diff: z.string().min(1),
	explanation: z.string().min(1),
	filesChanged: z.array(z.string()),
	testsPassed: z.boolean().nullable().default(null),
	tokensUsed: z.number().int().nullable().default(null),
	solverBackend: z.string(),
	solveDurationMs: z.number().int().min(0),
});
export type SubmitFixRequest = z.infer<typeof SubmitFixRequestSchema>;

export interface SubmitFixResponse {
	submissionId: string;
	status: "accepted" | "rejected_safety";
	safetyIssues?: string[];
}

// ── Review Vote ────────────────────────────────────────────────

export const SubmitVoteRequestSchema = z.object({
	decision: VoteDecisionSchema,
	reasoning: z.string().min(1),
	issuesFound: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1),
	testsRun: z.boolean(),
});
export type SubmitVoteRequest = z.infer<typeof SubmitVoteRequestSchema>;

export interface SubmitVoteResponse {
	accepted: boolean;
}

// ── Grid Stats ─────────────────────────────────────────────────

export interface GridStats {
	activeNodes: number;
	totalNodes: number;
	queueDepth: number;
	bountiesInProgress: number;
	prsSubmittedToday: number;
	prsSubmittedAllTime: number;
	totalTokensDonated: number;
	averageSolveTimeMs: number;
	mergeRate: number;
}

// ── Feed Events (WebSocket) ────────────────────────────────────

export type FeedEvent =
	| { type: "bounty_created"; bounty: z.infer<typeof BountySchema> }
	| { type: "bounty_assigned"; bountyId: string; nodeId: string }
	| { type: "fix_submitted"; submissionId: string; bountyId: string }
	| { type: "consensus_reached"; submissionId: string; outcome: string }
	| { type: "pr_submitted"; bountyId: string; prUrl: string }
	| { type: "node_joined"; nodeId: string; displayName: string | null }
	| { type: "node_left"; nodeId: string }
	| { type: "stats_update"; stats: GridStats };
