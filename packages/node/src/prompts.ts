import type { Bounty } from "@fairygitmother/core";
import type { RepoFile, RepoTree } from "./api-solver.js";

export function buildSolvePrompt(bounty: Bounty): string {
	return `You are fixing a GitHub issue in an open source repository.

## Issue #${bounty.issueNumber}: ${bounty.issueTitle}

${bounty.issueBody}

## Repository

${bounty.repoUrl}

## Instructions

1. Read the relevant source files to understand the codebase structure.
2. Identify the root cause of the issue.
3. Write a minimal, focused fix. Change only what is necessary.
4. Do NOT execute any scripts, build commands, or test runners from the repository.
5. Do NOT add unnecessary comments, docstrings, or refactoring beyond the fix.
6. Do NOT modify CI/CD pipelines, package manifests, or lock files unless the issue specifically requires it.

When you are done, provide a brief explanation of what you changed and why.

## Safety Rules

- NEVER run \`npm install\`, \`pip install\`, \`make\`, or any build/install command.
- NEVER execute any script from the repository.
- NEVER modify \`.github/\`, \`.gitlab-ci.yml\`, or other CI configs.
- Only read files and write your fix. Nothing else.`;
}

export function buildReviewPrompt(bounty: Bounty, diff: string, explanation: string): string {
	return `You are reviewing a proposed fix for a GitHub issue.

## Issue #${bounty.issueNumber}: ${bounty.issueTitle}

${bounty.issueBody}

## Proposed Fix

### Explanation
${explanation}

### Diff
\`\`\`diff
${diff}
\`\`\`

## Review Checklist

Go through each item in order. If ANY item fails, reject.

### 1. Correctness
- Does this fix address the root cause described in the issue?
- Trace the diff through the code — does the logic hold?
- Watch for fixes that mask symptoms without fixing the cause.

### 2. Security
REJECT immediately if the diff contains any of:
- \`eval()\`, \`exec()\`, \`child_process\`, \`os.system()\`, \`subprocess\`, \`Function()\`
- API keys, tokens, passwords, secrets, .env values, private keys
- Modifications to .github/, CI configs, Dockerfiles, or Makefiles (unless the issue requires it)
- New dependencies not mentioned in the issue

### 3. Minimality
- Only changes necessary to fix the issue — nothing more.
- REJECT if it includes: surrounding refactors, new comments on unchanged code,
  whitespace-only changes, import reordering, or unrelated fixes.

### 4. Regressions
- Is the changed code called from other places?
- Did function signatures, return types, or exports change?
- Was error handling removed or altered?

### 5. Style
- Same indentation, naming convention, and patterns as surrounding code.
- Minor style issues alone are NOT grounds for rejection.

## Confidence Calibration
- 0.9-1.0 = certain. 0.7-0.9 = high confidence.
- Below 0.7 = uncertain — default to reject.

## Response Format

Respond with a JSON object:
\`\`\`json
{
  "decision": "approve" | "reject",
  "reasoning": "Your detailed reasoning",
  "issuesFound": ["list of specific issues, if any"],
  "confidence": 0.0-1.0
}
\`\`\`

Be strict. Do not re-solve the issue or suggest alternatives — just evaluate what's in front of you.
If unsure, reject. It's better to reject a good fix than approve a bad one.`;
}

// ── API-only mode prompts ──────────────────────────────────────

export function buildApiSolvePrompt(bounty: Bounty, files: RepoFile[], tree: RepoTree): string {
	const fileList = tree.files
		.slice(0, 100)
		.map((f) => `  ${f.path} (${f.size} bytes)`)
		.join("\n");

	const fileContents = files
		.map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 10_000)}\n\`\`\``)
		.join("\n\n");

	return `You are fixing a GitHub issue. You have been given the relevant source files
read via the GitHub API. You do NOT have a local clone — produce your fix as
file changes (path + new content) that will be turned into a diff.

## Issue #${bounty.issueNumber}: ${bounty.issueTitle}

${bounty.issueBody}

## Repository Structure

${fileList}${tree.truncated ? "\n  ... (tree truncated)" : ""}

## Source Files

${fileContents}

## Instructions

1. Analyze the source files to understand the codebase.
2. Identify the root cause of the issue.
3. Produce a minimal fix. Change only what is necessary.
4. For each file you want to change, output the COMPLETE new file content.

## Response Format

Respond with a JSON object:
\`\`\`json
{
  "explanation": "What you changed and why",
  "changes": [
    {
      "path": "src/example.ts",
      "content": "...complete new file content..."
    }
  ]
}
\`\`\`

Only include files you are changing. Output the FULL file content for each changed file,
not just the diff. The system will compute the diff automatically.`;
}

export function buildApiReviewPrompt(
	bounty: Bounty,
	diff: string,
	explanation: string,
	files: RepoFile[],
): string {
	const fileContents = files
		.map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 10_000)}\n\`\`\``)
		.join("\n\n");

	return `You are reviewing a proposed fix for a GitHub issue. You have the original
source files (read via API) and the proposed diff.

## Issue #${bounty.issueNumber}: ${bounty.issueTitle}

${bounty.issueBody}

## Original Source Files

${fileContents}

## Proposed Fix

### Explanation
${explanation}

### Diff
\`\`\`diff
${diff}
\`\`\`

## Review Checklist

Go through each item in order. If ANY item fails, reject.

### 1. Correctness
- Does this fix address the root cause described in the issue?
- Trace the diff against the original source files — does the logic hold?
- Watch for fixes that mask symptoms without fixing the cause.

### 2. Security
REJECT immediately if the diff contains any of:
- \`eval()\`, \`exec()\`, \`child_process\`, \`os.system()\`, \`subprocess\`, \`Function()\`
- API keys, tokens, passwords, secrets, .env values, private keys
- Modifications to .github/, CI configs, Dockerfiles, or Makefiles (unless the issue requires it)
- New dependencies not mentioned in the issue

### 3. Minimality
- Only changes necessary to fix the issue — nothing more.
- REJECT if it includes: surrounding refactors, new comments on unchanged code,
  whitespace-only changes, import reordering, or unrelated fixes.

### 4. Regressions
- Is the changed code called from other places? Check the original source files.
- Did function signatures, return types, or exports change?
- Was error handling removed or altered?

### 5. Style
- Same indentation, naming convention, and patterns as the original source files.
- Minor style issues alone are NOT grounds for rejection.

## Confidence Calibration
- 0.9-1.0 = certain. 0.7-0.9 = high confidence.
- Below 0.7 = uncertain — default to reject.

## Response Format

\`\`\`json
{
  "decision": "approve" | "reject",
  "reasoning": "Your detailed reasoning",
  "issuesFound": ["list of specific issues, if any"],
  "confidence": 0.0-1.0
}
\`\`\`

Be strict. Do not re-solve the issue or suggest alternatives — just evaluate what's in front of you.
If unsure, reject. It's better to reject a good fix than approve a bad one.`;
}
