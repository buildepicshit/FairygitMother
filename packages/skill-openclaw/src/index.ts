import { loadConfig } from "@fairygitmother/core";
import {
	FairygitMotherClient,
	buildSolvePrompt,
	createIdleDetector,
	exportDiff,
	getChangedFiles,
	isDockerAvailable,
	safeClone,
} from "@fairygitmother/node";

export interface FairygitMotherSkillOptions {
	orchestratorUrl?: string;
	solverBackend?: string;
	languages?: string[];
	idleThresholdMinutes?: number;
	onLog?: (message: string) => void;
}

export async function startFairygitMother(options: FairygitMotherSkillOptions = {}) {
	const config = loadConfig({
		orchestratorUrl: options.orchestratorUrl,
		solverBackend: options.solverBackend ?? "openclaw",
		idleThresholdMinutes: options.idleThresholdMinutes,
	});

	const log = options.onLog ?? console.log;

	// Mandatory Docker check — fail fast before registering
	const dockerOk = await isDockerAvailable();
	if (!dockerOk) {
		throw new Error(
			"[fairygitmother] Docker is required. All FairygitMother workspaces run inside " +
				"isolated containers to protect your machine from untrusted repos. " +
				"Install Docker and ensure it is running, then try again.",
		);
	}

	const client = new FairygitMotherClient(config.orchestratorUrl);
	const idleDetector = createIdleDetector();

	// Register with the grid
	const registration = await client.register({
		displayName: null,
		capabilities: {
			languages: options.languages ?? [],
			tools: ["openclaw"],
		},
		solverBackend: config.solverBackend,
	});

	log(`[fairygitmother] Registered as node ${registration.nodeId}`);

	// Main loop
	let running = true;
	const heartbeatInterval = setInterval(async () => {
		if (!running) return;

		try {
			const idle = await idleDetector.isIdle(config.idleThresholdMinutes * 60_000);
			const response = await client.heartbeat(idle ? "idle" : "busy");

			if (response.pendingBounty) {
				log(`[fairygitmother] Received bounty: ${response.pendingBounty.issueTitle}`);
				await handleBounty(client, response.pendingBounty, config.solverBackend, log);
			}
		} catch (err) {
			log(`[fairygitmother] Heartbeat error: ${err}`);
		}
	}, config.heartbeatIntervalMs);

	return {
		nodeId: registration.nodeId,
		stop: async () => {
			running = false;
			clearInterval(heartbeatInterval);
			await client.disconnect();
			log("[fairygitmother] Disconnected from grid");
		},
		getStats: () => client.getStats(),
	};
}

async function handleBounty(
	client: FairygitMotherClient,
	bounty: any,
	solverBackend: string,
	log: (msg: string) => void,
) {
	const startTime = Date.now();

	try {
		// Safe clone — runs inside Docker container, network disconnected after clone
		log(`[fairygitmother] Cloning ${bounty.owner}/${bounty.repo} into isolated container...`);
		const sandbox = await safeClone(bounty.repoUrl);

		try {
			// Build the solve prompt — this is what gets fed to the agent
			const prompt = buildSolvePrompt(bounty);

			// In a real OpenClaw integration, this would call the agent's LLM
			// The agent reads/writes files inside the container via containerExec
			log(`[fairygitmother] Solve prompt ready for agent (${prompt.length} chars)`);
			log("[fairygitmother] Waiting for agent to produce a fix...");

			// After the agent works, extract the diff from the container
			const diff = await exportDiff(sandbox);
			const filesChanged = await getChangedFiles(sandbox);
			const durationMs = Date.now() - startTime;

			if (!diff.trim()) {
				log("[fairygitmother] No changes produced — skipping submission");
				return;
			}

			// Submit the fix
			const result = await client.submitFix(bounty.id, {
				diff,
				explanation: "Automated fix via FairygitMother grid",
				filesChanged,
				testsPassed: null,
				tokensUsed: null,
				solverBackend,
				solveDurationMs: durationMs,
			});

			if (result.status === "accepted") {
				log(`[fairygitmother] Fix submitted: ${result.submissionId}`);
			} else {
				log(`[fairygitmother] Fix rejected by safety scan: ${result.safetyIssues?.join(", ")}`);
			}
		} finally {
			// Kill container and clean up host-side output dir
			await sandbox.cleanup();
			log("[fairygitmother] Container destroyed");
		}
	} catch (err) {
		log(`[fairygitmother] Error handling bounty: ${err}`);
	}
}

export async function getFairygitMotherStatus(orchestratorUrl?: string) {
	const config = loadConfig({ orchestratorUrl });
	const client = new FairygitMotherClient(config.orchestratorUrl);
	return client.getStats();
}
