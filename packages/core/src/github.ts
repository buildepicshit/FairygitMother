import { Octokit } from "octokit";
import type { RepoConfig } from "./models.js";

export interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	labels: Array<{ name: string }>;
	assignee: { login: string } | null;
	pull_request?: unknown;
	html_url: string;
}

export interface GitHubRepo {
	full_name: string;
	owner: { login: string };
	name: string;
	language: string | null;
	size: number;
	stargazers_count: number;
	license: { spdx_id: string } | null;
	created_at: string;
}

export function createGitHubClient(token?: string): GitHubClient {
	return new GitHubClient(token);
}

export class GitHubClient {
	private octokit: Octokit;

	constructor(token?: string) {
		this.octokit = new Octokit({ auth: token });
	}

	async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
		const { data } = await this.octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
		return data as unknown as GitHubIssue;
	}

	async fetchGoodFirstIssues(
		owner: string,
		repo: string,
		limit = 10,
	): Promise<GitHubIssue[]> {
		const { data } = await this.octokit.rest.issues.listForRepo({
			owner,
			repo,
			labels: "good first issue",
			state: "open",
			per_page: limit,
		});
		return data as unknown as GitHubIssue[];
	}

	async searchIssuesGlobal(
		languages: string[],
		labels: string[],
		limit = 20,
	): Promise<GitHubIssue[]> {
		const langQuery = languages.map((l) => `language:${l}`).join(" ");
		const labelQuery = labels.map((l) => `label:"${l}"`).join(" ");
		const q = `is:issue is:open no:assignee ${labelQuery} ${langQuery}`.trim();

		const { data } = await this.octokit.rest.search.issuesAndPullRequests({
			q,
			per_page: limit,
			sort: "created",
			order: "desc",
		});
		return data.items as unknown as GitHubIssue[];
	}

	async getRepoInfo(owner: string, repo: string): Promise<GitHubRepo> {
		const { data } = await this.octokit.rest.repos.get({ owner, repo });
		return data as unknown as GitHubRepo;
	}

	async getRepoLanguages(owner: string, repo: string): Promise<Record<string, number>> {
		const { data } = await this.octokit.rest.repos.listLanguages({ owner, repo });
		return data;
	}

	async createFork(owner: string, repo: string): Promise<{ full_name: string; clone_url: string }> {
		const { data } = await this.octokit.rest.repos.createFork({ owner, repo });
		return { full_name: data.full_name, clone_url: data.clone_url };
	}

	async createPullRequest(
		owner: string,
		repo: string,
		head: string,
		base: string,
		title: string,
		body: string,
	): Promise<{ number: number; html_url: string }> {
		const { data } = await this.octokit.rest.pulls.create({
			owner,
			repo,
			head,
			base,
			title,
			body,
		});
		return { number: data.number, html_url: data.html_url };
	}

	async checkFairygitMotherConfig(
		owner: string,
		repo: string,
	): Promise<RepoConfig | null> {
		try {
			const { data } = await this.octokit.rest.repos.getContent({
				owner,
				repo,
				path: ".fairygitmother.yml",
			});
			if ("content" in data && typeof data.content === "string") {
				const content = Buffer.from(data.content, "base64").toString("utf-8");
				// Simple YAML parsing — only handles flat key: value
				return parseFairygitMotherYml(content);
			}
			return null;
		} catch {
			return null;
		}
	}
}

function parseFairygitMotherYml(content: string): RepoConfig {
	const lines = content.split("\n");
	const raw: Record<string, unknown> = {};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		const value = trimmed.slice(colonIdx + 1).trim();

		if (key === "enabled") {
			raw.enabled = value === "true";
		} else if (key === "maxPrsPerDay") {
			raw.maxPrsPerDay = Number.parseInt(value, 10);
		} else if (key === "labels" || key === "allowedPaths" || key === "excludedPaths") {
			raw[key] = value
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
		}
	}

	return raw as RepoConfig;
}
