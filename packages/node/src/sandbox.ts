import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export interface SafeCloneResult {
	containerId: string;
	workDir: string;
	cleanup: () => Promise<void>;
}

export interface SafeCloneOptions {
	maxRepoSizeMb?: number;
	cloneTimeoutMs?: number;
	containerMemoryMb?: number;
	containerCpus?: number;
}

export interface ContainerExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

// ── Docker availability check ──────────────────────────────────

let _dockerAvailable: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
	if (_dockerAvailable !== null) return _dockerAvailable;
	try {
		await exec("docker", ["info"], { timeout: 5000 });
		_dockerAvailable = true;
	} catch {
		_dockerAvailable = false;
	}
	return _dockerAvailable;
}

export function resetDockerCheck() {
	_dockerAvailable = null;
}

// ── Container image ────────────────────────────────────────────

const SANDBOX_IMAGE = "fairygitmother-sandbox";
const SANDBOX_IMAGE_VERSION = "2"; // Bump to force rebuild

export async function ensureSandboxImage(): Promise<void> {
	const tag = `${SANDBOX_IMAGE}:v${SANDBOX_IMAGE_VERSION}`;
	// Check if this version of the image exists
	try {
		await exec("docker", ["image", "inspect", tag], { timeout: 10_000 });
		return;
	} catch {
		// Image doesn't exist or wrong version, build it
	}

	const dockerfile = `
FROM alpine:3.20
RUN apk add --no-cache git
RUN adduser -D -h /workspace fairygitmother
RUN mkdir -p /output && chown fairygitmother:fairygitmother /output
USER fairygitmother
WORKDIR /workspace
`;

	const buildDir = join(tmpdir(), `fgm_build_${randomBytes(4).toString("hex")}`);
	await mkdir(buildDir, { recursive: true });
	await writeFile(join(buildDir, "Dockerfile"), dockerfile);

	try {
		await exec("docker", ["build", "-t", tag, buildDir], { timeout: 120_000 });
	} finally {
		await rm(buildDir, { recursive: true, force: true });
	}
}

// ── Safe clone (containerized) ─────────────────────────────────

export async function safeClone(
	repoUrl: string,
	options: SafeCloneOptions = {},
): Promise<SafeCloneResult> {
	const {
		maxRepoSizeMb = 500,
		cloneTimeoutMs = 120_000,
		containerMemoryMb = 512,
		containerCpus = 1,
	} = options;

	const dockerOk = await isDockerAvailable();
	if (!dockerOk) {
		throw new Error(
			"Docker is required for FairygitMother workspace isolation. " +
				"Install Docker and ensure it is running before using FairygitMother. " +
				"This is a mandatory security requirement — we never clone untrusted repos directly onto the host.",
		);
	}

	await ensureSandboxImage();

	// Host-side directory for extracting diffs (only diffs leave the container)
	const hostDir = join(tmpdir(), `fgm_${randomBytes(6).toString("hex")}`);
	await mkdir(hostDir, { recursive: true, mode: 0o777 });

	// Start container with /output as a tmpfs (avoids host volume permission issues).
	// Diffs are extracted by reading them via `docker exec` + stdout instead.
	const containerId = await exec(
		"docker",
		[
			"run",
			"-d",
			"--name",
			`fgm_${randomBytes(4).toString("hex")}`,
			`--memory=${containerMemoryMb}m`,
			`--cpus=${containerCpus}`,
			"--security-opt=no-new-privileges",
			"--pids-limit=100",
			"--tmpfs=/tmp:size=64m",
			"--tmpfs=/output:size=32m,uid=1000,gid=1000",
			`${SANDBOX_IMAGE}:v${SANDBOX_IMAGE_VERSION}`,
			"sleep",
			"3600",
		],
		{ timeout: 30_000 },
	);
	const cid = containerId.trim();

	try {
		// Phase 1: Clone with network access
		await containerExec(
			cid,
			[
				"git",
				"clone",
				"--depth",
				"1",
				"--single-branch",
				"--config",
				"core.hooksPath=/dev/null",
				"--config",
				"core.symlinks=false",
				"--config",
				"core.autocrlf=false",
				"--config",
				"transfer.fsckObjects=true",
				repoUrl,
				"/workspace/repo",
			],
			cloneTimeoutMs,
		);

		// Phase 2: Disconnect network — from this point, no external communication
		await exec("docker", ["network", "disconnect", "bridge", cid], { timeout: 10_000 });

		// Verify network disconnect succeeded
		const inspectResult = await exec(
			"docker",
			["inspect", "--format", "{{len .NetworkSettings.Networks}}", cid],
			{ timeout: 10_000 },
		);
		const networkCount = Number.parseInt(inspectResult.trim(), 10);
		if (networkCount > 0) {
			throw new Error(
				`Network disconnect verification failed: container still has ${networkCount} network(s) connected`,
			);
		}

		// Phase 3: Verify repo size
		const sizeResult = await containerExec(
			cid,
			["sh", "-c", "du -sm /workspace/repo | cut -f1"],
			30_000,
		);
		const sizeMb = Number.parseInt(sizeResult.stdout.trim(), 10);
		if (sizeMb > maxRepoSizeMb) {
			throw new Error(`Repo too large: ${sizeMb}MB (max ${maxRepoSizeMb}MB)`);
		}

		// Phase 4: Scan for dangerous git config (submodules, filters, LFS)
		await scanGitConfig(cid);

		return {
			containerId: cid,
			workDir: hostDir,
			cleanup: async () => {
				await exec("docker", ["rm", "-f", cid], { timeout: 10_000 }).catch(() => {});
				await rm(hostDir, { recursive: true, force: true });
			},
		};
	} catch (err) {
		// Cleanup on failure
		await exec("docker", ["rm", "-f", cid], { timeout: 10_000 }).catch(() => {});
		await rm(hostDir, { recursive: true, force: true }).catch(() => {});
		throw err;
	}
}

// ── Git operations (inside container) ──────────────────────────

export async function generateDiff(result: SafeCloneResult): Promise<string> {
	const r = await containerExec(
		result.containerId,
		["git", "-C", "/workspace/repo", "diff"],
		30_000,
	);
	return r.stdout;
}

export async function getStagedDiff(result: SafeCloneResult): Promise<string> {
	const r = await containerExec(
		result.containerId,
		["git", "-C", "/workspace/repo", "diff", "--cached"],
		30_000,
	);
	return r.stdout;
}

export async function getChangedFiles(result: SafeCloneResult): Promise<string[]> {
	const r = await containerExec(
		result.containerId,
		["git", "-C", "/workspace/repo", "diff", "--name-only"],
		30_000,
	);
	return r.stdout
		.trim()
		.split("\n")
		.filter((f) => f.length > 0);
}

export async function createBranch(result: SafeCloneResult, branchName: string): Promise<void> {
	await containerExec(
		result.containerId,
		["git", "-C", "/workspace/repo", "checkout", "-b", branchName],
		10_000,
	);
}

export async function commitAll(result: SafeCloneResult, message: string): Promise<void> {
	await containerExec(result.containerId, ["git", "-C", "/workspace/repo", "add", "-A"], 10_000);
	await containerExec(
		result.containerId,
		["git", "-C", "/workspace/repo", "commit", "-m", message],
		10_000,
	);
}

export async function readContainerFile(
	result: SafeCloneResult,
	relativePath: string,
): Promise<string> {
	validateRelativePath(relativePath);
	const r = await containerExec(
		result.containerId,
		["cat", `/workspace/repo/${relativePath}`],
		10_000,
	);
	return r.stdout;
}

export async function listContainerFiles(
	result: SafeCloneResult,
	relativePath = "",
): Promise<string[]> {
	if (relativePath) {
		validateRelativePath(relativePath);
	}
	const r = await containerExec(
		result.containerId,
		[
			"find",
			`/workspace/repo/${relativePath}`,
			"-type",
			"f",
			"-not",
			"-path",
			"*/\\.git/*",
			"-maxdepth",
			"3",
		],
		10_000,
	);
	return r.stdout
		.trim()
		.split("\n")
		.filter((f) => f.length > 0)
		.map((f) => f.replace("/workspace/repo/", ""));
}

/** Alias for generateDiff — kept for backward compatibility. */
export const exportDiff = generateDiff;

// ── Git config security scanning ───────────────────────────────

async function scanGitConfig(containerId: string): Promise<void> {
	const issues: string[] = [];

	// Check for submodules
	const submoduleCheck = await containerExec(
		containerId,
		["sh", "-c", "test -f /workspace/repo/.gitmodules && echo 'HAS_SUBMODULES' || echo 'OK'"],
		5_000,
	);
	if (submoduleCheck.stdout.trim() === "HAS_SUBMODULES") {
		issues.push("Repo contains git submodules — potential vector for pulling malicious content");
	}

	// Check for git LFS
	const lfsCheck = await containerExec(
		containerId,
		[
			"sh",
			"-c",
			"test -f /workspace/repo/.gitattributes && grep -l 'filter=lfs' /workspace/repo/.gitattributes && echo 'HAS_LFS' || echo 'OK'",
		],
		5_000,
	);
	if (lfsCheck.stdout.includes("HAS_LFS")) {
		issues.push("Repo uses Git LFS — large binary objects could be pulled");
	}

	// Check for custom filters in .gitattributes
	const filterCheck = await containerExec(
		containerId,
		[
			"sh",
			"-c",
			"test -f /workspace/repo/.gitattributes && grep -E 'filter=(?!lfs)' /workspace/repo/.gitattributes || echo 'OK'",
		],
		5_000,
	);
	if (!filterCheck.stdout.includes("OK") && filterCheck.stdout.trim().length > 0) {
		issues.push("Repo has custom git filters in .gitattributes — potential code execution vector");
	}

	// Check for post-checkout or other hooks smuggled as regular files
	const hookCheck = await containerExec(
		containerId,
		[
			"sh",
			"-c",
			"find /workspace/repo -name '*.hook' -o -name 'post-*' -o -name 'pre-*' | grep -v '.git/' | head -5 || echo 'OK'",
		],
		5_000,
	);
	if (!hookCheck.stdout.includes("OK") && hookCheck.stdout.trim().length > 0) {
		issues.push(`Suspicious hook-like files found: ${hookCheck.stdout.trim()}`);
	}

	if (issues.length > 0) {
		throw new Error(`Git security scan failed:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
	}
}

// ── Path validation ────────────────────────────────────────────

function validateRelativePath(relativePath: string): void {
	if (!relativePath) {
		throw new Error("Path must not be empty");
	}
	if (relativePath.includes("\0")) {
		throw new Error("Path must not contain null bytes");
	}
	if (relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) {
		throw new Error("Path must be relative, not absolute");
	}
	const segments = relativePath.split(/[/\\]/);
	for (const segment of segments) {
		if (segment === ".." || segment === ".") {
			throw new Error(`Path traversal not allowed: "${relativePath}"`);
		}
	}
}

// ── Container execution ────────────────────────────────────────

export async function containerExec(
	containerId: string,
	command: string[],
	timeoutMs = 30_000,
): Promise<ContainerExecResult> {
	return new Promise((resolve, reject) => {
		execFile(
			"docker",
			["exec", containerId, ...command],
			{ timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					const code = (err as any).code;
					// Distinguish between timeout and normal failure
					if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
						reject(new Error("Container command output too large"));
					} else if ((err as any).killed) {
						reject(new Error(`Container command timed out after ${timeoutMs}ms`));
					} else {
						reject(new Error(`Container command failed: ${stderr || err.message}`));
					}
				} else {
					resolve({ stdout, stderr, exitCode: 0 });
				}
			},
		);
	});
}

// ── Host-side exec helper ──────────────────────────────────────

function exec(command: string, args: string[], options: { timeout: number }): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ timeout: options.timeout, maxBuffer: 10 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					reject(new Error(`${command} failed: ${stderr || err.message}`));
				} else {
					resolve(stdout);
				}
			},
		);
	});
}
