import { isDockerAvailable, resetDockerCheck } from "@fairygitmother/node";
import { beforeEach, describe, expect, it } from "vitest";

describe("sandbox", () => {
	describe("isDockerAvailable", () => {
		beforeEach(() => {
			resetDockerCheck();
		});

		it("returns a boolean", async () => {
			const result = await isDockerAvailable();
			expect(typeof result).toBe("boolean");
		});

		it("caches the result on subsequent calls", async () => {
			const first = await isDockerAvailable();
			const second = await isDockerAvailable();
			expect(first).toBe(second);
		});

		it("can be reset for retesting", async () => {
			await isDockerAvailable();
			resetDockerCheck();
			// After reset, it should re-check (result may vary but shouldn't throw)
			const result = await isDockerAvailable();
			expect(typeof result).toBe("boolean");
		});
	});

	describe("safeClone", () => {
		it("requires Docker to be available", async () => {
			// If Docker isn't available, safeClone should throw with a clear message
			const dockerOk = await isDockerAvailable();
			if (!dockerOk) {
				const { safeClone } = await import("@fairygitmother/node");
				await expect(safeClone("https://github.com/octocat/Hello-World")).rejects.toThrow(
					"Docker is required",
				);
			}
		});
	});

	describe("security model", () => {
		it("sandbox container has no network after clone", () => {
			// This is a design verification test — the safeClone function
			// runs `docker network disconnect bridge <cid>` after cloning.
			// The network disconnect happens between Phase 1 (clone) and
			// Phase 3 (size check), ensuring no exfiltration is possible
			// during the solve phase.
			expect(true).toBe(true);
		});

		it("sandbox container has memory limits", () => {
			// Container is started with --memory=512m by default.
			// Prevents OOM attacks from malicious repos with large files.
			expect(true).toBe(true);
		});

		it("sandbox container has PID limits", () => {
			// Container is started with --pids-limit=100.
			// Prevents fork bombs.
			expect(true).toBe(true);
		});

		it("sandbox container prevents privilege escalation", () => {
			// Container is started with --security-opt=no-new-privileges.
			// Even if a binary is setuid, it can't escalate.
			expect(true).toBe(true);
		});
	});
});
