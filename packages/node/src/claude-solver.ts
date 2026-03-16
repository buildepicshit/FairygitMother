/**
 * Claude API solver — uses the Anthropic API to read code and produce fixes.
 *
 * This is the "brain" that turns FairygitMother from a pipeline into a product.
 * Given a bounty and repo files (fetched via GitHub API), it asks Claude to
 * analyze the issue and produce file changes. The changes get turned into a
 * unified diff and submitted through the normal consensus pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Bounty } from "@fairygitmother/core";
import type { RepoFile, RepoTree, FileChange } from "./api-solver.js";
import { buildApiSolvePrompt, buildApiReviewPrompt } from "./prompts.js";

// ── Types ──────────────────────────────────────────────────────

export interface ClaudeSolverOptions {
	apiKey: string;
	model?: string;
	maxTokens?: number;
}

export interface SolveResult {
	success: boolean;
	changes: FileChange[];
	explanation: string;
	tokensUsed: number;
	error?: string;
}

export interface ReviewResult {
	decision: "approve" | "reject";
	reasoning: string;
	issuesFound: string[];
	confidence: number;
	tokensUsed: number;
}

// ── Solver ─────────────────────────────────────────────────────

export async function solveBounty(
	bounty: Bounty,
	files: RepoFile[],
	tree: RepoTree,
	options: ClaudeSolverOptions,
): Promise<SolveResult> {
	const client = new Anthropic({ apiKey: options.apiKey });
	const model = options.model ?? "claude-sonnet-4-20250514";
	const maxTokens = options.maxTokens ?? 8192;

	const prompt = buildApiSolvePrompt(bounty, files, tree);

	try {
		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
			messages: [{ role: "user", content: prompt }],
		});

		const tokensUsed =
			(response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);

		// Extract text content
		const text = response.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("\n");

		// Parse the JSON response
		const parsed = parseAgentResponse(text, files);
		if (!parsed) {
			return {
				success: false,
				changes: [],
				explanation: "",
				tokensUsed,
				error: "Failed to parse agent response as JSON",
			};
		}

		return {
			success: parsed.changes.length > 0,
			changes: parsed.changes,
			explanation: parsed.explanation,
			tokensUsed,
		};
	} catch (err) {
		return {
			success: false,
			changes: [],
			explanation: "",
			tokensUsed: 0,
			error: `Claude API error: ${err}`,
		};
	}
}

// ── Reviewer ───────────────────────────────────────────────────

export async function reviewFix(
	bounty: Bounty,
	diff: string,
	explanation: string,
	files: RepoFile[],
	options: ClaudeSolverOptions,
): Promise<ReviewResult> {
	const client = new Anthropic({ apiKey: options.apiKey });
	const model = options.model ?? "claude-sonnet-4-20250514";
	const maxTokens = options.maxTokens ?? 4096;

	const prompt = buildApiReviewPrompt(bounty, diff, explanation, files);

	try {
		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
			messages: [{ role: "user", content: prompt }],
		});

		const tokensUsed =
			(response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);

		const text = response.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("\n");

		const parsed = parseReviewResponse(text);
		if (!parsed) {
			// Default to reject if we can't parse
			return {
				decision: "reject",
				reasoning: "Failed to parse review response",
				issuesFound: ["Unparseable review output"],
				confidence: 0,
				tokensUsed,
			};
		}

		return { ...parsed, tokensUsed };
	} catch (err) {
		return {
			decision: "reject",
			reasoning: `Claude API error: ${err}`,
			issuesFound: ["API error during review"],
			confidence: 0,
			tokensUsed: 0,
		};
	}
}

// ── Response parsers ───────────────────────────────────────────

interface AgentResponse {
	explanation: string;
	changes: FileChange[];
}

function parseAgentResponse(
	text: string,
	originalFiles: RepoFile[],
): AgentResponse | null {
	const json = extractJson(text);
	if (!json) return null;

	try {
		const data = JSON.parse(json);
		if (!data.explanation || !Array.isArray(data.changes)) return null;

		const changes: FileChange[] = [];
		for (const change of data.changes) {
			if (!change.path || !change.content) continue;

			// Find the original file content for diff generation
			const original = originalFiles.find((f) => f.path === change.path);
			changes.push({
				path: change.path,
				originalContent: original?.content ?? "",
				newContent: change.content,
			});
		}

		return { explanation: data.explanation, changes };
	} catch {
		return null;
	}
}

function parseReviewResponse(
	text: string,
): Omit<ReviewResult, "tokensUsed"> | null {
	const json = extractJson(text);
	if (!json) return null;

	try {
		const data = JSON.parse(json);
		const decision = data.decision === "approve" ? "approve" : "reject";
		return {
			decision,
			reasoning: data.reasoning ?? "",
			issuesFound: Array.isArray(data.issuesFound) ? data.issuesFound : [],
			confidence: typeof data.confidence === "number" ? data.confidence : 0.5,
		};
	} catch {
		return null;
	}
}

function extractJson(text: string): string | null {
	// Try to find JSON in code blocks first
	const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
	if (codeBlockMatch) return codeBlockMatch[1].trim();

	// Try to find raw JSON object
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) return jsonMatch[0];

	return null;
}
