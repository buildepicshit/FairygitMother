import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateApiKey, generateId } from "@fairygitmother/core";
import * as schema from "@fairygitmother/server/db/schema.js";
import {
	dequeueForNode,
	getQueueDepth,
	markAssigned,
	requeue,
} from "@fairygitmother/server/orchestrator/queue.js";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

function createTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const migration = readFileSync(
		resolve(import.meta.dirname, "../../../migrations/0001_initial.sql"),
		"utf-8",
	);
	sqlite.exec(migration);
	return drizzle(sqlite, { schema });
}

function insertBounty(
	db: ReturnType<typeof drizzle>,
	overrides: Partial<typeof schema.bounties.$inferInsert> = {},
) {
	const bounty = {
		id: generateId("bty"),
		owner: "testorg",
		repo: "testrepo",
		issueNumber: Math.floor(Math.random() * 1000),
		issueTitle: "Test issue",
		issueBody: "Fix this",
		labels: ["good first issue"],
		language: "TypeScript",
		complexityEstimate: 2,
		status: "queued",
		priority: 50,
		retryCount: 0,
		...overrides,
	};
	db.insert(schema.bounties).values(bounty).run();
	return bounty;
}

function insertNode(
	db: ReturnType<typeof drizzle>,
	overrides: Partial<typeof schema.nodes.$inferInsert> = {},
) {
	const node = {
		id: generateId("node"),
		apiKey: generateApiKey(),
		capabilities: { languages: ["TypeScript"], tools: [] },
		solverBackend: "test",
		status: "idle",
		reputationScore: 50,
		totalTokensDonated: 0,
		totalBountiesSolved: 0,
		totalReviewsDone: 0,
		...overrides,
	};
	db.insert(schema.nodes).values(node).run();
	return node;
}

describe("queue", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
	});

	describe("getQueueDepth", () => {
		it("returns 0 for empty queue", () => {
			expect(getQueueDepth(db)).toBe(0);
		});

		it("counts queued bounties", () => {
			insertBounty(db);
			insertBounty(db);
			insertBounty(db, { status: "assigned" });
			expect(getQueueDepth(db)).toBe(2);
		});
	});

	describe("dequeueForNode", () => {
		it("returns null when no bounties", () => {
			const node = insertNode(db);
			expect(dequeueForNode(db, node.id)).toBeNull();
		});

		it("returns highest priority bounty", () => {
			const node = insertNode(db);
			insertBounty(db, { priority: 100, issueTitle: "Low priority" });
			insertBounty(db, { priority: 10, issueTitle: "High priority" });
			const result = dequeueForNode(db, node.id);
			expect(result?.issueTitle).toBe("High priority");
		});

		it("matches language capabilities", () => {
			const node = insertNode(db, { capabilities: { languages: ["Python"], tools: [] } });
			insertBounty(db, { language: "TypeScript", issueTitle: "TS issue" });
			insertBounty(db, { language: "Python", issueTitle: "Python issue" });
			const result = dequeueForNode(db, node.id);
			expect(result?.issueTitle).toBe("Python issue");
		});

		it("skips blacklisted repos", () => {
			const node = insertNode(db);
			db.insert(schema.repos)
				.values({
					owner: "testorg",
					name: "testrepo",
					blacklisted: true,
				})
				.run();
			insertBounty(db);
			expect(dequeueForNode(db, node.id)).toBeNull();
		});
	});

	describe("markAssigned", () => {
		it("updates bounty status and node", () => {
			const bounty = insertBounty(db);
			const node = insertNode(db);
			markAssigned(db, bounty.id, node.id);

			const updated = db
				.select()
				.from(schema.bounties)
				.where(eq(schema.bounties.id, bounty.id))
				.get();
			expect(updated?.status).toBe("assigned");
			expect(updated?.assignedNodeId).toBe(node.id);
		});
	});

	describe("requeue", () => {
		it("increments retry count and resets status", () => {
			const bounty = insertBounty(db, { status: "assigned", retryCount: 1 });
			requeue(db, bounty.id);

			const updated = db
				.select()
				.from(schema.bounties)
				.where(eq(schema.bounties.id, bounty.id))
				.get();
			expect(updated?.status).toBe("queued");
			expect(updated?.assignedNodeId).toBeNull();
			expect(updated?.retryCount).toBe(2);
		});
	});
});
