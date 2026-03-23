/**
 * Authenticated WebSocket connections for nodes.
 *
 * Nodes connect to /api/v1/nodes/ws?apiKey=<key> and receive targeted
 * work dispatch in real-time instead of waiting for the next heartbeat.
 *
 * This is a performance optimization — heartbeat polling still works as
 * a fallback for nodes that don't maintain a WebSocket connection.
 */

import type { Context } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { findNodeByApiKey } from "../orchestrator/registry.js";

interface ConnectedNode {
	nodeId: string;
	ws: import("ws").WebSocket;
	status: "idle" | "busy";
	capabilities: { languages: string[]; tools: string[] };
}

const connectedNodes = new Map<string, ConnectedNode>();

/** Ping interval (ms) — server pings each node every 30 seconds */
const PING_INTERVAL_MS = 30_000;
/** Pong timeout (ms) — if no pong arrives within 10 seconds, close the connection */
const PONG_TIMEOUT_MS = 10_000;

/**
 * Send a message to a specific connected node.
 * Returns true if the message was sent, false if node is not connected.
 */
export function pushToNode(nodeId: string, message: Record<string, unknown>): boolean {
	const node = connectedNodes.get(nodeId);
	if (!node || node.ws.readyState !== node.ws.OPEN) return false;
	try {
		node.ws.send(JSON.stringify(message));
		return true;
	} catch {
		return false;
	}
}

/**
 * Broadcast a message to all connected idle nodes (excluding a specific node).
 * Used to notify available nodes that work is ready.
 */
export function pushToIdleNodes(message: Record<string, unknown>, excludeNodeId?: string): number {
	let sent = 0;
	for (const [nodeId, node] of connectedNodes) {
		if (nodeId === excludeNodeId) continue;
		if (node.status !== "idle") continue;
		if (node.ws.readyState !== node.ws.OPEN) continue;
		try {
			node.ws.send(JSON.stringify(message));
			sent++;
		} catch {
			// Skip failed sends
		}
	}
	return sent;
}

/**
 * Update a connected node's status (called from heartbeat handler).
 */
export function updateNodeStatus(nodeId: string, status: "idle" | "busy") {
	const node = connectedNodes.get(nodeId);
	if (node) node.status = status;
}

export function getConnectedNodeCount(): number {
	return connectedNodes.size;
}

/**
 * Hono route handler — returns 426 for non-upgrade HTTP requests.
 */
export function nodeWsRouteHandler(c: Context) {
	return c.json(
		{
			error: "WebSocket connection required",
			hint: "Connect via ws:// protocol with ?apiKey=<your-api-key>",
		},
		426,
	);
}

/**
 * Attach the authenticated node WebSocket handler to a Node HTTP server.
 */
export function attachNodeWebSocketHandler(
	server: import("node:http").Server | import("node:net").Server,
	db: FairygitMotherDb,
) {
	import("ws")
		.then(({ WebSocketServer }) => {
			const wss = new WebSocketServer({ noServer: true });

			(server as import("node:http").Server).on("upgrade", (request, socket, head) => {
				const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

				if (url.pathname !== "/api/v1/nodes/ws") return;

				const apiKey = url.searchParams.get("apiKey");
				if (!apiKey) {
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
					socket.destroy();
					return;
				}

				// Authenticate asynchronously, then upgrade
				findNodeByApiKey(db, apiKey)
					.then((node) => {
						if (!node) {
							socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
							socket.destroy();
							return;
						}

						wss.handleUpgrade(request, socket, head, (ws) => {
							// Remove existing connection for this node (reconnect)
							const existing = connectedNodes.get(node.id);
							if (existing) {
								try {
									existing.ws.close();
								} catch {
									// Ignore
								}
							}

							const capabilities = node.capabilities as {
								languages: string[];
								tools: string[];
							};

							connectedNodes.set(node.id, {
								nodeId: node.id,
								ws,
								status: (node.status as "idle" | "busy") ?? "idle",
								capabilities,
							});

							// ── Ping/pong keepalive ──────────────────────────────
							// Server pings every PING_INTERVAL_MS.  If no pong
							// arrives within PONG_TIMEOUT_MS, the connection is
							// considered stale and is terminated.
							let pongTimer: ReturnType<typeof setTimeout> | null = null;

							const pingInterval = setInterval(() => {
								if (ws.readyState !== ws.OPEN) {
									clearInterval(pingInterval);
									return;
								}
								ws.ping();
								pongTimer = setTimeout(() => {
									console.log(
										`[node-push] Node ${node.id} pong timeout — closing stale connection`,
									);
									ws.terminate();
								}, PONG_TIMEOUT_MS);
							}, PING_INTERVAL_MS);

							ws.on("pong", () => {
								if (pongTimer) {
									clearTimeout(pongTimer);
									pongTimer = null;
								}
							});
							// ─────────────────────────────────────────────────────

							ws.on("close", () => {
								clearInterval(pingInterval);
								if (pongTimer) clearTimeout(pongTimer);
								connectedNodes.delete(node.id);
							});

							ws.on("error", () => {
								clearInterval(pingInterval);
								if (pongTimer) clearTimeout(pongTimer);
								connectedNodes.delete(node.id);
							});

							// Handle status updates from the node
							ws.on("message", (data) => {
								try {
									const msg = JSON.parse(data.toString());
									if (msg.type === "status" && (msg.status === "idle" || msg.status === "busy")) {
										updateNodeStatus(node.id, msg.status);
									}
								} catch {
									// Ignore malformed messages
								}
							});

							ws.send(
								JSON.stringify({
									type: "connected",
									nodeId: node.id,
									timestamp: new Date().toISOString(),
								}),
							);

							console.log(`[node-push] Node ${node.id} connected via WebSocket`);
						});
					})
					.catch(() => {
						socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
						socket.destroy();
					});
			});

			console.log("[node-push] Node WebSocket handler attached at /api/v1/nodes/ws");
		})
		.catch((err) => {
			console.warn("[node-push] 'ws' package not available — node push disabled.", err);
		});
}
