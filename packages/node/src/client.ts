import type {
	ClaimBountyResponse,
	GridStats,
	HeartbeatRequest,
	HeartbeatResponse,
	RegisterNodeRequest,
	RegisterNodeResponse,
	SubmitFixRequest,
	SubmitFixResponse,
	SubmitVoteRequest,
	SubmitVoteResponse,
} from "@fairygitmother/core";

export class FairygitMotherClient {
	private baseUrl: string;
	private apiKey: string | null;
	private nodeId: string | null;

	constructor(orchestratorUrl: string, apiKey?: string, nodeId?: string) {
		this.baseUrl = orchestratorUrl.replace(/\/$/, "");
		this.apiKey = apiKey ?? null;
		this.nodeId = nodeId ?? null;
	}

	get registeredNodeId(): string | null {
		return this.nodeId;
	}

	async register(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
		const res = await this.fetch("/api/v1/nodes/register", "POST", request);
		this.nodeId = res.nodeId;
		this.apiKey = res.apiKey;
		return res;
	}

	async heartbeat(status: HeartbeatRequest["status"], tokensUsed = 0): Promise<HeartbeatResponse> {
		if (!this.nodeId) throw new Error("Not registered");
		return this.fetch(`/api/v1/nodes/${this.nodeId}/heartbeat`, "POST", {
			status,
			tokensUsedSinceLastHeartbeat: tokensUsed,
		});
	}

	async claimBounty(): Promise<ClaimBountyResponse> {
		if (!this.nodeId) throw new Error("Not registered");
		return this.fetch("/api/v1/bounties/claim", "POST", { nodeId: this.nodeId });
	}

	async submitFix(bountyId: string, fix: SubmitFixRequest): Promise<SubmitFixResponse> {
		return this.fetch(`/api/v1/bounties/${bountyId}/submit`, "POST", fix);
	}

	async submitVote(submissionId: string, vote: SubmitVoteRequest): Promise<SubmitVoteResponse> {
		if (!this.nodeId) throw new Error("Not registered");
		return this.fetch(`/api/v1/reviews/${submissionId}/vote`, "POST", {
			...vote,
			reviewerNodeId: this.nodeId,
		});
	}

	async getStats(): Promise<GridStats> {
		return this.fetch("/api/v1/stats", "GET");
	}

	async disconnect(): Promise<void> {
		if (!this.nodeId) return;
		await this.fetch(`/api/v1/nodes/${this.nodeId}`, "DELETE");
		this.nodeId = null;
		this.apiKey = null;
	}

	private async fetch(path: string, method: string, body?: unknown): Promise<any> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}

		const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`FairygitMother API error (${response.status}): ${text}`);
		}

		return response.json();
	}
}
