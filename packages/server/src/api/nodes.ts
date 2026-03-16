import { HeartbeatRequestSchema, RegisterNodeRequestSchema } from "@fairygitmother/core";
import { Hono } from "hono";
import type { FairygitMotherDb } from "../db/client.js";
import { dequeueForNode, markAssigned } from "../orchestrator/queue.js";
import { heartbeat, registerNode, removeNode } from "../orchestrator/registry.js";

export function createNodeRoutes(db: FairygitMotherDb) {
	const app = new Hono();

	// POST /api/v1/nodes/register
	app.post("/register", async (c) => {
		const body = await c.req.json();
		const parsed = RegisterNodeRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
		}

		const { displayName, capabilities, solverBackend } = parsed.data;
		const result = registerNode(db, displayName, capabilities, solverBackend);

		return c.json({ nodeId: result.id, apiKey: result.apiKey }, 201);
	});

	// POST /api/v1/nodes/:id/heartbeat
	app.post("/:id/heartbeat", async (c) => {
		const nodeId = c.req.param("id");
		const authenticatedNodeId = c.get("nodeId") as string;
		if (authenticatedNodeId !== nodeId) {
			return c.json({ error: "Forbidden: node ID mismatch" }, 403);
		}

		const body = await c.req.json();
		const parsed = HeartbeatRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request" }, 400);
		}

		heartbeat(db, nodeId, parsed.data.status, parsed.data.tokensUsedSinceLastHeartbeat);

		// Check for pending work when node is idle
		let pendingBounty = null;
		if (parsed.data.status === "idle") {
			const bounty = dequeueForNode(db, nodeId);
			if (bounty) {
				markAssigned(db, bounty.id, nodeId);
				pendingBounty = {
					...bounty,
					repoUrl: `https://github.com/${bounty.owner}/${bounty.repo}`,
					status: "assigned" as const,
					assignedNodeId: nodeId,
					retryCount: 0,
					createdAt: new Date().toISOString(),
				};
			}
		}

		return c.json({
			acknowledged: true,
			pendingBounty,
			pendingReview: null, // TODO: check for pending reviews
		});
	});

	// DELETE /api/v1/nodes/:id
	app.delete("/:id", async (c) => {
		const nodeId = c.req.param("id");
		const authenticatedNodeId = c.get("nodeId") as string;
		if (authenticatedNodeId !== nodeId) {
			return c.json({ error: "Forbidden: node ID mismatch" }, 403);
		}

		removeNode(db, nodeId);
		return c.json({ removed: true });
	});

	return app;
}
