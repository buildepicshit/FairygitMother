type Task = () => Promise<void>;

interface ScheduledTask {
	name: string;
	task: Task;
	intervalMs: number;
	timer: ReturnType<typeof setInterval> | null;
	isRunning: boolean;
}

const tasks: Map<string, ScheduledTask> = new Map();

export function scheduleTask(name: string, task: Task, intervalMs: number) {
	// Clear existing task with same name
	stopTask(name);

	const scheduled: ScheduledTask = { name, task, intervalMs, timer: null, isRunning: false };
	scheduled.timer = setInterval(async () => {
		if (scheduled.isRunning) {
			return;
		}
		scheduled.isRunning = true;
		try {
			await task();
		} catch (err) {
			console.error(`[scheduler] Task "${name}" failed:`, err);
		} finally {
			scheduled.isRunning = false;
		}
	}, intervalMs);

	tasks.set(name, scheduled);
}

export function stopTask(name: string) {
	const existing = tasks.get(name);
	if (existing?.timer) {
		clearInterval(existing.timer);
		existing.timer = null;
	}
	tasks.delete(name);
}

export function stopAll() {
	for (const scheduled of tasks.values()) {
		if (scheduled.timer) {
			clearInterval(scheduled.timer);
		}
	}
	tasks.clear();
}
