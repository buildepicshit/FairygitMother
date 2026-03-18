import { App, Octokit } from "octokit";
import { type RepoConfig, RepoConfigSchema } from "./models.js";

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

export interface GitHubAppAuth {
	appId: string;
	privateKey: string;
	installationId: string;
}

export function createGitHubClient(token?: string): GitHubClient {
	return new GitHubClient(token);
}

export async function createGitHubAppClient(auth: GitHubAppAuth): Promise<GitHubClient> {
	const app = new App({
		appId: auth.appId,
		privateKey: auth.privateKey,
	});
	const octokit = (await app.getInstallationOctokit(
		Number(auth.installationId),
	)) as unknown as Octokit;
	return new GitHubClient(undefined, octokit);
}

export class GitHubClient {
	private octokit: Octokit;

	constructor(token?: string, octokit?: Octokit) {
		this.octokit = octokit ?? new Octokit({ auth: token });
	}

	async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
		const { data } = await this.octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
		return data as unknown as GitHubIssue;
	}

	async fetchGoodFirstIssues(owner: string, repo: string, limit = 10): Promise<GitHubIssue[]> {
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
		// Guard against empty filters — without language or label filters,
		// this would search all open issues on GitHub
		if (languages.length === 0 && labels.length === 0) {
			return [];
		}

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

	async getTreeRecursive(
		owner: string,
		repo: string,
		treeSha: string,
	): Promise<{
		tree: Array<{ path: string; size?: number; sha: string; type: string }>;
		truncated: boolean;
	}> {
		const { data } = await this.octokit.rest.git.getTree({
			owner,
			repo,
			tree_sha: treeSha,
			recursive: "1",
		});
		return {
			tree: data.tree.map((entry) => ({
				path: entry.path ?? "",
				size: entry.size,
				sha: entry.sha ?? "",
				type: entry.type ?? "",
			})),
			truncated: data.truncated,
		};
	}

	async getContentRaw(
		owner: string,
		repo: string,
		path: string,
	): Promise<{ type: string; encoding?: string; content?: string; size: number; sha: string }> {
		const { data } = await this.octokit.rest.repos.getContent({ owner, repo, path });
		if (Array.isArray(data)) {
			throw new Error(`${path} is a directory, not a file`);
		}
		return {
			type: data.type,
			encoding: "encoding" in data ? (data.encoding as string) : undefined,
			content: "content" in data ? (data.content as string) : undefined,
			size: data.size,
			sha: data.sha,
		};
	}

	// ── Git Data API (for programmatic commits) ─────────────────

	async getRef(owner: string, repo: string, ref: string): Promise<string> {
		const { data } = await this.octokit.rest.git.getRef({ owner, repo, ref });
		return data.object.sha;
	}

	async getCommit(owner: string, repo: string, sha: string): Promise<{ treeSha: string }> {
		const { data } = await this.octokit.rest.git.getCommit({ owner, repo, commit_sha: sha });
		return { treeSha: data.tree.sha };
	}

	async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
		const { data } = await this.octokit.rest.repos.getContent({
			owner,
			repo,
			path,
			...(ref ? { ref } : {}),
		});
		if ("content" in data && typeof data.content === "string") {
			return Buffer.from(data.content, "base64").toString("utf-8");
		}
		throw new Error(`Cannot read file content for ${path}`);
	}

	async createBlob(owner: string, repo: string, content: string): Promise<string> {
		const { data } = await this.octokit.rest.git.createBlob({
			owner,
			repo,
			content,
			encoding: "utf-8",
		});
		return data.sha;
	}

	async createTree(
		owner: string,
		repo: string,
		baseTreeSha: string,
		files: Array<{ path: string; content: string }>,
	): Promise<string> {
		const blobs = await Promise.all(
			files.map(async (f) => ({
				path: f.path,
				mode: "100644" as const,
				type: "blob" as const,
				sha: await this.createBlob(owner, repo, f.content),
			})),
		);
		const { data } = await this.octokit.rest.git.createTree({
			owner,
			repo,
			base_tree: baseTreeSha,
			tree: blobs,
		});
		return data.sha;
	}

	async createCommitOnRepo(
		owner: string,
		repo: string,
		message: string,
		treeSha: string,
		parentShas: string[],
	): Promise<string> {
		const { data } = await this.octokit.rest.git.createCommit({
			owner,
			repo,
			message,
			tree: treeSha,
			parents: parentShas,
		});
		return data.sha;
	}

	async createRefOnRepo(owner: string, repo: string, ref: string, sha: string): Promise<void> {
		await this.octokit.rest.git.createRef({ owner, repo, ref, sha });
	}

	async deleteRef(owner: string, repo: string, ref: string): Promise<void> {
		await this.octokit.rest.git.deleteRef({ owner, repo, ref });
	}

	async getPullRequestState(
		owner: string,
		repo: string,
		pullNumber: number,
	): Promise<{ state: "open" | "closed"; merged: boolean }> {
		const { data } = await this.octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
		return { state: data.state as "open" | "closed", merged: data.merged };
	}

	async closePullRequest(owner: string, repo: string, pullNumber: number): Promise<void> {
		await this.octokit.rest.pulls.update({ owner, repo, pull_number: pullNumber, state: "closed" });
	}

	async commentOnIssue(
		owner: string,
		repo: string,
		issueNumber: number,
		body: string,
	): Promise<void> {
		await this.octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
	}

	async checkFairygitMotherConfig(owner: string, repo: string): Promise<RepoConfig | null> {
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

	return RepoConfigSchema.parse(raw);
}
