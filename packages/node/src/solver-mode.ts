/**
 * Solver mode selection — determines whether to use API-only or container mode
 * for a given bounty based on the node operator's trust configuration.
 *
 * Default: API mode (zero attack surface, no clone, no Docker)
 * Container mode: only for repos the operator has explicitly trusted
 */

import type { SolverMode, TrustedRepo } from "@fairygitmother/core";

export interface SolverModeDecision {
	mode: SolverMode;
	reason: string;
}

/**
 * Decides which solver mode to use for a bounty.
 *
 * Rules:
 * 1. If the repo is in the trusted list → container mode
 * 2. If default is "container" AND Docker is available → container mode
 * 3. Otherwise → api mode (safe default)
 */
export function selectSolverMode(
	owner: string,
	repo: string,
	defaultMode: SolverMode,
	trustedRepos: TrustedRepo[],
	dockerAvailable: boolean,
): SolverModeDecision {
	// Check if repo is explicitly trusted
	const trusted = trustedRepos.some(
		(r) =>
			r.owner.toLowerCase() === owner.toLowerCase() &&
			(r.repo === "*" || r.repo.toLowerCase() === repo.toLowerCase()),
	);

	if (trusted && dockerAvailable) {
		return {
			mode: "container",
			reason: `${owner}/${repo} is in trusted repos list`,
		};
	}

	if (trusted && !dockerAvailable) {
		return {
			mode: "api",
			reason: `${owner}/${repo} is trusted but Docker is not available — falling back to API mode`,
		};
	}

	if (defaultMode === "container" && dockerAvailable) {
		return {
			mode: "container",
			reason: "default mode is container and Docker is available",
		};
	}

	return {
		mode: "api",
		reason: "using API mode (no local clone, zero attack surface)",
	};
}

/**
 * Checks if a repo matches any entry in the trusted repos list.
 * Supports wildcards: { owner: "myorg", repo: "*" } trusts all repos from myorg.
 */
export function isRepoTrusted(
	owner: string,
	repo: string,
	trustedRepos: TrustedRepo[],
): boolean {
	return trustedRepos.some(
		(r) =>
			r.owner.toLowerCase() === owner.toLowerCase() &&
			(r.repo === "*" || r.repo.toLowerCase() === repo.toLowerCase()),
	);
}
