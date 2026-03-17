import { z } from "zod";

// ── Solver mode ────────────────────────────────────────────────

export const SolverModeSchema = z.enum(["api", "container"]);
export type SolverMode = z.infer<typeof SolverModeSchema>;

// ── Trusted repos (allowed for container mode) ─────────────────

export const TrustedRepoSchema = z.object({
	owner: z.string(),
	repo: z.string(),
});
export type TrustedRepo = z.infer<typeof TrustedRepoSchema>;

// ── Main config ────────────────────────────────────────────────

export const FairygitMotherConfigSchema = z.object({
	orchestratorUrl: z.string().url().default("http://localhost:3000"),
	nodeId: z.string().optional(),
	apiKey: z.string().optional(),
	githubToken: z.string().optional(),
	solverBackend: z.string().default("openclaw"),
	defaultSolverMode: SolverModeSchema.default("api"),
	trustedRepos: z.array(TrustedRepoSchema).default([]),
	idleThresholdMinutes: z.number().int().min(1).default(5),
	dbPath: z.string().default("fairygitmother.db"),
	port: z.number().int().min(1).max(65535).default(3000),
	host: z.string().default("0.0.0.0"),
	maxPrsPerRepoPerDay: z.number().int().min(1).default(3),
	maxPrsPerDay: z.number().int().min(1).default(10),
	trawlIntervalMs: z.number().int().min(10_000).default(300_000),
	heartbeatIntervalMs: z.number().int().min(5_000).default(3_600_000),
	nodeTimeoutMs: z.number().int().min(30_000).default(7_200_000),
	consensusTimeoutMs: z.number().int().min(60_000).default(1_800_000),
	maxDiffLines: z.number().int().min(10).default(500),
	maxDiffFiles: z.number().int().min(1).default(10),
	maxRepoSizeMb: z.number().int().min(10).default(500),
	forkOwner: z.string().optional(),
	autoSubmitPrs: z.boolean().default(false),
	githubAppId: z.string().optional(),
	githubAppPrivateKey: z.string().optional(),
	githubAppInstallationId: z.string().optional(),
});
export type FairygitMotherConfig = z.infer<typeof FairygitMotherConfigSchema>;

export function loadConfig(overrides: Partial<FairygitMotherConfig> = {}): FairygitMotherConfig {
	const env = typeof process !== "undefined" ? process.env : {};
	const raw: Record<string, unknown> = {
		orchestratorUrl: env.FAIRYGITMOTHER_ORCHESTRATOR_URL,
		nodeId: env.FAIRYGITMOTHER_NODE_ID,
		apiKey: env.FAIRYGITMOTHER_API_KEY,
		githubToken: env.GITHUB_TOKEN ?? env.GH_TOKEN,
		solverBackend: env.FAIRYGITMOTHER_SOLVER_BACKEND,
		idleThresholdMinutes: env.FAIRYGITMOTHER_IDLE_THRESHOLD_MINUTES
			? Number(env.FAIRYGITMOTHER_IDLE_THRESHOLD_MINUTES)
			: undefined,
		dbPath: env.FAIRYGITMOTHER_DB_PATH,
		port: env.FAIRYGITMOTHER_PORT ? Number(env.FAIRYGITMOTHER_PORT) : undefined,
		host: env.FAIRYGITMOTHER_HOST,
		forkOwner: env.FAIRYGITMOTHER_FORK_OWNER,
		autoSubmitPrs: env.FAIRYGITMOTHER_AUTO_SUBMIT_PRS === "true" ? true : undefined,
		githubAppId: env.FAIRYGITMOTHER_GITHUB_APP_ID,
		githubAppPrivateKey: env.FAIRYGITMOTHER_GITHUB_APP_PRIVATE_KEY,
		githubAppInstallationId: env.FAIRYGITMOTHER_GITHUB_APP_INSTALLATION_ID,
		...overrides,
	};

	// Strip undefined values so Zod defaults kick in
	const cleaned = Object.fromEntries(
		Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""),
	);

	return FairygitMotherConfigSchema.parse(cleaned);
}
