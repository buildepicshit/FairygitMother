import type { FeedEvent } from "@fairygitmother/core";
import type { Context } from "hono";
import { addFeedListener } from "./feed.js";

/**
 * WebSocket upgrade handler for the real-time feed.
 *
 * Uses Node's built-in HTTP upgrade mechanism since @hono/node-ws is not
 * installed. The Hono route returns 426 Upgrade Required for plain HTTP
 * requests; actual WebSocket upgrades are handled by attaching to the
 * underlying Node HTTP server's "upgrade" event via `attachWebSocketHandler`.
 */

// Track active WebSocket connections for clean shutdown
const activeSockets = new Set<import("node:ws").WebSocket>();

/**
 * Hono route handler — returns 426 for non-upgrade HTTP requests.
 * Clients should connect via ws:// protocol instead.
 */
export function feedRouteHandler(c: Context) {
	// If someone hits this via plain HTTP, tell them to upgrade
	return c.json(
		{
			error: "WebSocket connection required",
			hint: "Connect via ws:// protocol to this endpoint for the real-time feed",
		},
		426,
	);
}

/**
 * Attach the WebSocket upgrade handler to a Node HTTP server.
 *
 * Call this after creating the server:
 *   const server = serve({ fetch: app.fetch, port });
 *   attachWebSocketHandler(server);
 */
export function attachWebSocketHandler(
	server: import("node:http").Server | import("node:net").Server,
) {
	// Dynamically import ws to avoid hard dep at module level
	import("ws")
		.then(({ WebSocketServer }) => {
			const wss = new WebSocketServer({ noServer: true });

			(server as import("node:http").Server).on("upgrade", (request, socket, head) => {
				const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

				if (url.pathname !== "/api/v1/feed") {
					// Don't destroy — other handlers (node-push) may claim this path
					return;
				}

				wss.handleUpgrade(request, socket, head, (ws) => {
					wss.emit("connection", ws, request);
				});
			});

			wss.on("connection", (ws) => {
				activeSockets.add(ws);

				const removeListener = addFeedListener((event: FeedEvent) => {
					if (ws.readyState === ws.OPEN) {
						try {
							ws.send(JSON.stringify(event));
						} catch {
							// Send failed — client probably disconnected
						}
					}
				});

				ws.on("close", () => {
					removeListener();
					activeSockets.delete(ws);
				});

				ws.on("error", () => {
					removeListener();
					activeSockets.delete(ws);
				});

				// Send a welcome event so the client knows connection is live
				if (ws.readyState === ws.OPEN) {
					try {
						ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
					} catch {
						// Swallow
					}
				}
			});

			console.log("[websocket] Feed WebSocket handler attached at /api/v1/feed");
		})
		.catch((err) => {
			console.warn("[websocket] 'ws' package not available — WebSocket feed disabled.", err);
		});
}
