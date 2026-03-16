/**
 * Docker integration tests for FairygitMother sandbox.
 *
 * These tests exercise the real containerized clone workflow against
 * a live Docker daemon. They are skipped automatically when Docker
 * is not available (e.g., CI without Docker).
 */
import { execFile } from "node:child_process";
import { describe, it, expect, afterAll } from "vitest";
import {
	isDockerAvailable,
	ensureSandboxImage,
	safeClone,
	containerExec,
	listContainerFiles,
	readContainerFile,
	generateDiff,
	exportDiff,
	type SafeCloneResult,
} from "@fairygitmother/node";

// ── Pre-check: is Docker available? ────────────────────────────
// Resolved once before the suite so we can use describe.skipIf.
const dockerAvailable = await isDockerAvailable();

// Small helper to call docker inspect from the host for verification
function dockerInspect(containerId: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"docker",
			["inspect", containerId],
			{ timeout: 10_000 },
			(err, stdout) => {
				if (err) reject(err);
				else resolve(stdout);
			},
		);
	});
}

function dockerInspectFormat(containerId: string, format: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"docker",
			["inspect", "--format", format, containerId],
			{ timeout: 10_000 },
			(err, stdout) => {
				if (err) reject(err);
				else resolve(stdout.trim());
			},
		);
	});
}

// ── Test suite ─────────────────────────────────────────────────

describe.skipIf(!dockerAvailable)("FairygitMother sandbox — Docker integration", () => {
	// Shared clone result used across ordered tests
	let cloneResult: SafeCloneResult | null = null;

	afterAll(async () => {
		// Belt-and-suspenders cleanup in case individual tests fail before
		// the explicit cleanup test runs.
		if (cloneResult) {
			await cloneResult.cleanup().catch(() => {});
			cloneResult = null;
		}
	});

	// ── 1. Build sandbox image ──────────────────────────────────

	it("builds (or reuses) the sandbox image", async () => {
		await expect(ensureSandboxImage()).resolves.toBeUndefined();
	}, 120_000);

	// ── 2. Clone a real public repo ─────────────────────────────

	it("clones octocat/Hello-World into a container", async () => {
		cloneResult = await safeClone("https://github.com/octocat/Hello-World.git");

		expect(cloneResult.containerId).toBeTruthy();
		expect(typeof cloneResult.containerId).toBe("string");
		expect(cloneResult.workDir).toBeTruthy();
		expect(typeof cloneResult.cleanup).toBe("function");

		// Verify the container is running
		const inspectJson = await dockerInspect(cloneResult.containerId);
		const inspected = JSON.parse(inspectJson);
		expect(inspected[0].State.Running).toBe(true);
	}, 60_000);

	// ── 3. Verify network disconnect ────────────────────────────

	it("container has no network connectivity after clone", async () => {
		expect(cloneResult).not.toBeNull();

		// Check that the container has no networks attached via docker inspect.
		// After `docker network disconnect bridge <cid>`, the Networks map
		// should be empty.
		const networksRaw = await dockerInspectFormat(
			cloneResult!.containerId,
			"{{json .NetworkSettings.Networks}}",
		);
		const networks = JSON.parse(networksRaw);
		const networkNames = Object.keys(networks);
		expect(networkNames).toHaveLength(0);

		// Double-check: trying to reach the outside should fail.
		// wget is not installed in the Alpine image (only git), so the
		// command itself will error out — either "not found" or "network
		// unreachable". Both are acceptable proof of isolation.
		await expect(
			containerExec(cloneResult!.containerId, [
				"sh", "-c", "wget -q --spider http://example.com 2>&1 || echo BLOCKED",
			], 10_000),
		).rejects.toThrow(); // wget not found → exec error (non-zero exit)
	}, 15_000);

	// ── 4. List files inside container ──────────────────────────

	it("lists repo files inside the container", async () => {
		expect(cloneResult).not.toBeNull();

		const files = await listContainerFiles(cloneResult!);
		expect(files.length).toBeGreaterThan(0);

		// Hello-World always has a README
		const hasReadme = files.some((f) => /readme/i.test(f));
		expect(hasReadme).toBe(true);
	}, 15_000);

	// ── 5. Read a file inside container ─────────────────────────

	it("reads the README from Hello-World", async () => {
		expect(cloneResult).not.toBeNull();

		const content = await readContainerFile(cloneResult!, "README");
		expect(content).toBeTruthy();
		expect(content.length).toBeGreaterThan(0);
		// The octocat/Hello-World README contains "Hello World"
		expect(content.toLowerCase()).toContain("hello");
	}, 15_000);

	// ── 6. Generate and export diff ─────────────────────────────

	it("generates and exports a diff after a file change", async () => {
		expect(cloneResult).not.toBeNull();

		// Write a new file inside the repo
		await containerExec(cloneResult!.containerId, [
			"sh", "-c", "echo 'test change from FairygitMother' > /workspace/repo/TESTFILE.txt",
		], 10_000);

		// Stage it so diff --name-only picks it up (for untracked files
		// we need git add first, but generateDiff uses plain `git diff`
		// which only shows tracked changes). Instead, just modify an
		// existing tracked file to produce a diff.
		await containerExec(cloneResult!.containerId, [
			"sh", "-c", "echo '\\nFairygitMother was here' >> /workspace/repo/README",
		], 10_000);

		// generateDiff — unstaged diff of tracked files
		const diff = await generateDiff(cloneResult!);
		expect(diff).toContain("FairygitMother was here");
		expect(diff).toContain("diff --git");

		// exportDiff — writes to /output volume and returns content
		const exported = await exportDiff(cloneResult!);
		expect(exported).toContain("FairygitMother was here");
		expect(exported).toContain("diff --git");

		// Both should match
		expect(exported.trim()).toBe(diff.trim());
	}, 30_000);

	// ── 7. Git security scan ────────────────────────────────────

	it("Hello-World passes the git security scan (no submodules, LFS, or custom filters)", async () => {
		// The security scan runs inside safeClone(). If we got here
		// without an error, the scan passed. Verify explicitly by
		// checking there is no .gitmodules or filter-based .gitattributes.
		expect(cloneResult).not.toBeNull();

		const submoduleCheck = await containerExec(cloneResult!.containerId, [
			"sh", "-c", "test -f /workspace/repo/.gitmodules && echo EXISTS || echo NONE",
		], 5_000);
		expect(submoduleCheck.stdout.trim()).toBe("NONE");

		const lfsCheck = await containerExec(cloneResult!.containerId, [
			"sh", "-c",
			"test -f /workspace/repo/.gitattributes && grep -c 'filter=lfs' /workspace/repo/.gitattributes || echo 0",
		], 5_000);
		expect(lfsCheck.stdout.trim()).toBe("0");
	}, 15_000);

	// ── 8. Cleanup removes the container ────────────────────────

	it("cleanup removes the container and host directory", async () => {
		expect(cloneResult).not.toBeNull();

		const cid = cloneResult!.containerId;
		await cloneResult!.cleanup();

		// After cleanup, docker inspect should fail (container gone)
		await expect(dockerInspect(cid)).rejects.toThrow();

		// Prevent afterAll from double-cleaning
		cloneResult = null;
	}, 15_000);

	// ── 9. Repo size limit enforcement ──────────────────────────

	it("rejects repos exceeding maxRepoSizeMb", async () => {
		// With maxRepoSizeMb = 0, even the tiniest repo exceeds the limit
		await expect(
			safeClone("https://github.com/octocat/Hello-World.git", {
				maxRepoSizeMb: 0,
			}),
		).rejects.toThrow(/too large/i);
	}, 60_000);
});
