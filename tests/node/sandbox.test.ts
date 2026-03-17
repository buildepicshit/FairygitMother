import { isDockerAvailable, resetDockerCheck, safeClone } from "@fairygitmother/node";
import { beforeEach, describe, expect, it } from "vitest";

// Access the non-exported validateRelativePath by testing through the public API
// We import readContainerFile and listContainerFiles for path traversal tests
import { listContainerFiles, readContainerFile } from "@fairygitmother/node";

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
			const dockerOk = await isDockerAvailable();
			if (!dockerOk) {
				await expect(safeClone("https://github.com/octocat/Hello-World")).rejects.toThrow(
					"Docker is required",
				);
			}
		});
	});

	describe("path traversal protection", () => {
		const fakeResult = {
			containerId: "fake-container",
			workDir: "/tmp/fake",
			cleanup: async () => {},
		};

		it("rejects path with .. traversal", async () => {
			await expect(readContainerFile(fakeResult, "../../../etc/passwd")).rejects.toThrow(
				"Path traversal not allowed",
			);
		});

		it("rejects absolute paths", async () => {
			await expect(readContainerFile(fakeResult, "/etc/passwd")).rejects.toThrow(
				"Path must be relative, not absolute",
			);
		});

		it("rejects paths with null bytes", async () => {
			await expect(readContainerFile(fakeResult, "file\0.txt")).rejects.toThrow(
				"Path must not contain null bytes",
			);
		});

		it("rejects listContainerFiles with traversal", async () => {
			await expect(listContainerFiles(fakeResult, "../../etc")).rejects.toThrow(
				"Path traversal not allowed",
			);
		});
	});
});
