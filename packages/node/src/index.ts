export { FairygitMotherClient } from "./client.js";
export {
	safeClone,
	generateDiff,
	getStagedDiff,
	getChangedFiles,
	createBranch,
	commitAll,
	readContainerFile,
	listContainerFiles,
	exportDiff,
	containerExec,
	isDockerAvailable,
	resetDockerCheck,
	ensureSandboxImage,
	type SafeCloneResult,
	type SafeCloneOptions,
	type ContainerExecResult,
} from "./sandbox.js";
export {
	buildSolvePrompt,
	buildReviewPrompt,
	buildApiSolvePrompt,
	buildApiReviewPrompt,
} from "./prompts.js";
export {
	fetchRepoTree,
	fetchFile,
	fetchFiles,
	buildApiSolverContext,
	generateUnifiedDiff,
	type ApiSolverContext,
	type RepoFile,
	type RepoTree,
	type FileChange,
	type ApiSolverResult,
} from "./api-solver.js";
export {
	selectSolverMode,
	isRepoTrusted,
	type SolverModeDecision,
} from "./solver-mode.js";
export { createIdleDetector, type IdleDetector } from "./idle.js";
