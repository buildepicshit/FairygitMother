import { type FairygitMotherConfig, loadConfig } from "@fairygitmother/core";
import { type SafetyCheckResult, checkDiffSafety } from "../orchestrator/governor.js";

export type { SafetyCheckResult };

const PROMPT_INJECTION_PATTERNS = [
	/ignore\s+(all\s+)?previous\s+instructions/i,
	/you\s+are\s+now\s+/i,
	/system\s*:\s*/i,
	/\[INST\]/i,
	/<\|im_start\|>/i,
	/\bACT\s+AS\b/i,
];

export function scanDiff(
	diff: string,
	filesChanged: string[],
	config?: FairygitMotherConfig,
): SafetyCheckResult {
	const cfg = config ?? loadConfig();
	const base = checkDiffSafety(diff, filesChanged, cfg);

	// Additional prompt injection scanning
	for (const pattern of PROMPT_INJECTION_PATTERNS) {
		if (pattern.test(diff)) {
			base.issues.push(`Potential prompt injection: ${pattern.source}`);
		}
	}

	return { safe: base.issues.length === 0, issues: base.issues };
}

export function scanSourceFile(content: string): string[] {
	const issues: string[] = [];

	for (const pattern of PROMPT_INJECTION_PATTERNS) {
		if (pattern.test(content)) {
			issues.push(`Prompt injection pattern in source: ${pattern.source}`);
		}
	}

	return issues;
}
