import type { FeedEvent } from "@fairygitmother/core";
import { addFeedListener, emitEvent, getListenerCount } from "@fairygitmother/server/api/feed.js";
import { afterEach, describe, expect, it } from "vitest";

describe("feed pub/sub (WebSocket backing)", () => {
	let removers: Array<() => void> = [];

	afterEach(() => {
		// Clean up all listeners added during tests
		for (const remove of removers) {
			remove();
		}
		removers = [];
	});

	describe("addFeedListener", () => {
		it("increases listener count on subscription", () => {
			const before = getListenerCount();
			const remove = addFeedListener(() => {});
			removers.push(remove);

			expect(getListenerCount()).toBe(before + 1);
		});

		it("decreases listener count when removed", () => {
			const before = getListenerCount();
			const remove = addFeedListener(() => {});

			expect(getListenerCount()).toBe(before + 1);

			remove();
			expect(getListenerCount()).toBe(before);
		});

		it("supports multiple listeners", () => {
			const before = getListenerCount();
			const r1 = addFeedListener(() => {});
			const r2 = addFeedListener(() => {});
			const r3 = addFeedListener(() => {});
			removers.push(r1, r2, r3);

			expect(getListenerCount()).toBe(before + 3);
		});
	});

	describe("emitEvent", () => {
		it("sends events to all listeners", () => {
			const received1: FeedEvent[] = [];
			const received2: FeedEvent[] = [];

			removers.push(addFeedListener((e) => received1.push(e)));
			removers.push(addFeedListener((e) => received2.push(e)));

			const event: FeedEvent = {
				type: "node_joined",
				nodeId: "node_123",
				displayName: "TestNode",
			};
			emitEvent(event);

			expect(received1).toHaveLength(1);
			expect(received1[0]).toEqual(event);
			expect(received2).toHaveLength(1);
			expect(received2[0]).toEqual(event);
		});

		it("does not crash if a listener throws", () => {
			removers.push(
				addFeedListener(() => {
					throw new Error("boom");
				}),
			);

			const received: FeedEvent[] = [];
			removers.push(addFeedListener((e) => received.push(e)));

			const event: FeedEvent = {
				type: "node_left",
				nodeId: "node_456",
			};

			// Should not throw
			expect(() => emitEvent(event)).not.toThrow();

			// Second listener still received the event
			expect(received).toHaveLength(1);
			expect(received[0]).toEqual(event);
		});

		it("does not send to removed listeners", () => {
			const received: FeedEvent[] = [];
			const remove = addFeedListener((e) => received.push(e));

			remove();

			emitEvent({
				type: "node_left",
				nodeId: "node_789",
			});

			expect(received).toHaveLength(0);
		});
	});
});
