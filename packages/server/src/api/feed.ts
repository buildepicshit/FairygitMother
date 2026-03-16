import type { FeedEvent } from "@fairygitmother/core";

type Listener = (event: FeedEvent) => void;

let listeners: Set<Listener> = new Set();

export function addFeedListener(listener: Listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitEvent(event: FeedEvent) {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch {
			// Swallow errors from individual listeners
		}
	}
}

export function getListenerCount(): number {
	return listeners.size;
}

export function resetFeed() {
	listeners = new Set();
}
