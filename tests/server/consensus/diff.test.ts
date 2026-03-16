import { applyPatch, parseDiff } from "@fairygitmother/server/consensus/diff.js";
import { describe, expect, it } from "vitest";

describe("diff parser", () => {
	describe("parseDiff", () => {
		it("parses a single-file diff", () => {
			const diff = `--- a/src/fix.ts
+++ b/src/fix.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);
			expect(files[0].oldPath).toBe("src/fix.ts");
			expect(files[0].newPath).toBe("src/fix.ts");
			expect(files[0].isNew).toBe(false);
			expect(files[0].isDeleted).toBe(false);
			expect(files[0].hunks).toHaveLength(1);
			expect(files[0].hunks[0].oldStart).toBe(1);
			expect(files[0].hunks[0].oldCount).toBe(3);
			expect(files[0].hunks[0].newStart).toBe(1);
			expect(files[0].hunks[0].newCount).toBe(3);
		});

		it("parses a multi-file diff", () => {
			const diff = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,2 +5,3 @@
 keep
-remove
+add1
+add2`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(2);
			expect(files[0].oldPath).toBe("src/a.ts");
			expect(files[1].oldPath).toBe("src/b.ts");
		});

		it("parses a new file diff", () => {
			const diff = `--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const x = 1;
+export default x;`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);
			expect(files[0].isNew).toBe(true);
			expect(files[0].newPath).toBe("src/new.ts");
		});

		it("parses a deleted file diff", () => {
			const diff = `--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-export default x;`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);
			expect(files[0].isDeleted).toBe(true);
			expect(files[0].oldPath).toBe("src/old.ts");
		});

		it("handles diff --git headers", () => {
			const diff = `diff --git a/src/fix.ts b/src/fix.ts
--- a/src/fix.ts
+++ b/src/fix.ts
@@ -1 +1 @@
-broken
+fixed`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);
			expect(files[0].oldPath).toBe("src/fix.ts");
		});

		it("handles multiple hunks in one file", () => {
			const diff = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
@@ -10,3 +10,3 @@
 line10
-line11
+LINE11
 line12`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);
			expect(files[0].hunks).toHaveLength(2);
			expect(files[0].hunks[0].oldStart).toBe(1);
			expect(files[0].hunks[1].oldStart).toBe(10);
		});
	});

	describe("applyPatch", () => {
		it("applies a simple replacement", () => {
			const original = "const a = 1;\nconst b = 2;\nconst c = 3;";
			const hunks = [
				{
					oldStart: 1,
					oldCount: 3,
					newStart: 1,
					newCount: 3,
					lines: [" const a = 1;", "-const b = 2;", "+const b = 99;", " const c = 3;"],
				},
			];

			const result = applyPatch(original, hunks);
			expect(result).toBe("const a = 1;\nconst b = 99;\nconst c = 3;");
		});

		it("applies an addition", () => {
			const original = "line1\nline2\nline3";
			const hunks = [
				{
					oldStart: 2,
					oldCount: 1,
					newStart: 2,
					newCount: 2,
					lines: [" line2", "+inserted"],
				},
			];

			const result = applyPatch(original, hunks);
			expect(result).toBe("line1\nline2\ninserted\nline3");
		});

		it("applies a deletion", () => {
			const original = "line1\nline2\nline3\nline4";
			const hunks = [
				{
					oldStart: 2,
					oldCount: 2,
					newStart: 2,
					newCount: 1,
					lines: ["-line2", " line3"],
				},
			];

			const result = applyPatch(original, hunks);
			expect(result).toBe("line1\nline3\nline4");
		});

		it("applies new file", () => {
			const hunks = [
				{
					oldStart: 0,
					oldCount: 0,
					newStart: 1,
					newCount: 2,
					lines: ["+const x = 1;", "+export default x;"],
				},
			];

			const result = applyPatch("", hunks, true);
			expect(result).toBe("const x = 1;\nexport default x;");
		});

		it("returns empty for deleted file", () => {
			const result = applyPatch("some content", [], false, true);
			expect(result).toBe("");
		});

		it("applies multiple hunks", () => {
			const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`);
			const original = lines.join("\n");

			const hunks = [
				{
					oldStart: 2,
					oldCount: 1,
					newStart: 2,
					newCount: 1,
					lines: ["-line2", "+LINE2"],
				},
				{
					oldStart: 10,
					oldCount: 1,
					newStart: 10,
					newCount: 1,
					lines: ["-line10", "+LINE10"],
				},
			];

			const result = applyPatch(original, hunks);
			const resultLines = result.split("\n");
			expect(resultLines[1]).toBe("LINE2");
			expect(resultLines[9]).toBe("LINE10");
			expect(resultLines[0]).toBe("line1");
			expect(resultLines[14]).toBe("line15");
		});
	});

	describe("parseDiff + applyPatch integration", () => {
		it("parses and applies a complete diff", () => {
			const original = "const a = 1;\nconst b = 2;\nconst c = 3;";
			const diff = `--- a/src/fix.ts
+++ b/src/fix.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 42;
 const c = 3;`;

			const files = parseDiff(diff);
			expect(files).toHaveLength(1);

			const result = applyPatch(original, files[0].hunks);
			expect(result).toBe("const a = 1;\nconst b = 42;\nconst c = 3;");
		});
	});
});
