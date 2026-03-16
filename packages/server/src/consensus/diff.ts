/**
 * Unified diff parser and applier.
 * Parses unified diffs into per-file changes and applies them to original content.
 */

export interface DiffHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: string[];
}

export interface FileDiff {
	oldPath: string;
	newPath: string;
	hunks: DiffHunk[];
	isNew: boolean;
	isDeleted: boolean;
}

/**
 * Parse a unified diff string into per-file diffs.
 */
export function parseDiff(diff: string): FileDiff[] {
	const files: FileDiff[] = [];
	const lines = diff.split("\n");
	let i = 0;

	while (i < lines.length) {
		// Look for --- a/path or --- /dev/null
		if (!lines[i].startsWith("---")) {
			i++;
			continue;
		}

		const oldLine = lines[i];
		i++;
		if (i >= lines.length || !lines[i].startsWith("+++")) {
			continue;
		}
		const newLine = lines[i];
		i++;

		const oldPath = parseFilePath(oldLine);
		const newPath = parseFilePath(newLine);
		const isNew = oldLine.includes("/dev/null");
		const isDeleted = newLine.includes("/dev/null");

		const hunks: DiffHunk[] = [];

		// Parse hunks for this file
		while (i < lines.length && !lines[i].startsWith("---")) {
			if (lines[i].startsWith("@@")) {
				const hunk = parseHunkHeader(lines[i]);
				if (hunk) {
					i++;
					// Collect hunk lines
					while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("---")) {
						const line = lines[i];
						if (
							line.startsWith("+") ||
							line.startsWith("-") ||
							line.startsWith(" ") ||
							line === ""
						) {
							hunk.lines.push(line);
						} else {
							// Could be a "\ No newline at end of file" or diff metadata — skip
							if (!line.startsWith("\\") && !line.startsWith("diff ")) {
								break;
							}
						}
						i++;
					}
					hunks.push(hunk);
				} else {
					i++;
				}
			} else if (lines[i].startsWith("diff ")) {
				// Skip diff --git header lines
				i++;
			} else {
				i++;
			}
		}

		files.push({ oldPath, newPath, hunks, isNew, isDeleted });
	}

	return files;
}

/**
 * Apply parsed hunks to original file content to produce the new content.
 * For new files, pass empty string as original.
 * For deleted files, returns empty string.
 */
export function applyPatch(
	original: string,
	hunks: DiffHunk[],
	isNew = false,
	isDeleted = false,
): string {
	if (isDeleted) return "";
	if (isNew) {
		// New file: extract only "+" lines
		return hunks
			.flatMap((h) => h.lines)
			.filter((l) => l.startsWith("+"))
			.map((l) => l.slice(1))
			.join("\n");
	}

	const originalLines = original.split("\n");
	const result: string[] = [];
	let originalIdx = 0;

	for (const hunk of hunks) {
		// Copy lines before this hunk (1-indexed oldStart)
		const hunkStart = hunk.oldStart - 1;
		while (originalIdx < hunkStart) {
			result.push(originalLines[originalIdx]);
			originalIdx++;
		}

		// Apply hunk lines
		for (const line of hunk.lines) {
			if (line.startsWith(" ")) {
				// Context line — advance both
				result.push(originalLines[originalIdx]);
				originalIdx++;
			} else if (line.startsWith("-")) {
				// Removed line — skip in original
				originalIdx++;
			} else if (line.startsWith("+")) {
				// Added line
				result.push(line.slice(1));
			}
			// Empty lines in hunk are context
			else if (line === "") {
				result.push(originalLines[originalIdx]);
				originalIdx++;
			}
		}
	}

	// Copy remaining lines after last hunk
	while (originalIdx < originalLines.length) {
		result.push(originalLines[originalIdx]);
		originalIdx++;
	}

	return result.join("\n");
}

function parseFilePath(line: string): string {
	// "--- a/path/to/file" → "path/to/file"
	// "--- /dev/null" → "/dev/null"
	const match = line.match(/^[-+]{3}\s+(?:[ab]\/)?(.+)$/);
	return match ? match[1] : "";
}

function parseHunkHeader(line: string): DiffHunk | null {
	// "@@ -1,3 +1,4 @@" or "@@ -1 +1,2 @@"
	const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
	if (!match) return null;
	return {
		oldStart: Number.parseInt(match[1], 10),
		oldCount: match[2] !== undefined ? Number.parseInt(match[2], 10) : 1,
		newStart: Number.parseInt(match[3], 10),
		newCount: match[4] !== undefined ? Number.parseInt(match[4], 10) : 1,
		lines: [],
	};
}
