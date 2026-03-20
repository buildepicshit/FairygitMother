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

export type PushHandler = (message: Record<string, unknown>) => void;

export class FairygitMotherClient {
	private baseUrl: string;
	private apiKey: string | null;
	private nodeId: string | null;
	private ws: WebSocket | null = null;
	private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pushHandlers: Set<PushHandler> = new Set();

	constructor(orchestratorUrl: string, apiKey?: string, nodeId?: string) {
		this.baseUrl = orchestratorUrl.replace(/\/$/, "");
		this.apiKey = apiKey ?? null;
		this.nodeId = nodeId ?? null;
	}

	get registeredNodeId(): string | null {
		return this.nodeId;
	}

	async register(request: RegisterNodeRequest): Promise<RegisterNodeResponse> {
		// Send existing apiKey so the server can reconnect instead of duplicating
		const payload = this.apiKey ? { ...request, apiKey: this.apiKey } : request;
		const res = await this.fetch("/api/v1/nodes/register", "POST", payload);
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
		return this.fetch("/api/v1/bounties/claim", "POST");
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
		this.disconnectWebSocket();
		if (!this.nodeId) return;
		await this.fetch(`/api/v1/nodes/${this.nodeId}`, "DELETE");
		this.nodeId = null;
		this.apiKey = null;
	}

	/**
	 * Register a handler for push notifications from the server.
	 * Messages include: { type: "work_available", ... }, { type: "review_available", ... }
	 */
	onPush(handler: PushHandler): () => void {
		this.pushHandlers.add(handler);
		return () => this.pushHandlers.delete(handler);
	}

	/**
	 * Connect to the server's WebSocket for real-time push notifications.
	 * Auto-reconnects on disconnect with exponential backoff.
	 */
	connectWebSocket(): void {
		if (!this.apiKey) return;

		const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/api/v1/nodes/ws?apiKey=${this.apiKey}`;

		try {
			this.ws = new WebSocket(wsUrl);
		} catch {
			this.scheduleReconnect();
			return;
		}

		this.ws.onopen = () => {
			console.log("[fgm-client] WebSocket connected");
		};

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
				for (const handler of this.pushHandlers) {
					try {
						handler(msg);
					} catch {
						// Don't let one handler crash others
					}
				}
			} catch {
				// Ignore malformed messages
			}
		};

		this.ws.onclose = () => {
			this.ws = null;
			this.scheduleReconnect();
		};

		this.ws.onerror = () => {
			// onclose will fire after onerror
		};
	}

	/**
	 * Send a status update to the server over WebSocket.
	 */
	sendStatus(status: "idle" | "busy"): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: "status", status }));
		}
	}

	private disconnectWebSocket(): void {
		if (this.wsReconnectTimer) {
			clearTimeout(this.wsReconnectTimer);
			this.wsReconnectTimer = null;
		}
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				// Ignore
			}
			this.ws = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.wsReconnectTimer) return;
		this.wsReconnectTimer = setTimeout(() => {
			this.wsReconnectTimer = null;
			if (this.apiKey) this.connectWebSocket();
		}, 5000);
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
