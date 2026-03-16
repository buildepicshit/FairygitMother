// OpenClaw lifecycle hooks for the FairygitMother skill
// These integrate with OpenClaw's event system

export interface OpenClawHooks {
	onActivate?: () => Promise<void>;
	onDeactivate?: () => Promise<void>;
	onIdle?: () => Promise<void>;
	onCommand?: (command: string, args: string[]) => Promise<string>;
}

export function createFairygitMotherHooks(
	start: () => Promise<{ stop: () => Promise<void> }>,
): OpenClawHooks {
	let instance: { stop: () => Promise<void> } | null = null;

	return {
		async onActivate() {
			// Skill activated — prepare but don't start yet
		},

		async onDeactivate() {
			if (instance) {
				await instance.stop();
				instance = null;
			}
		},

		async onIdle() {
			// Auto-start when idle if not already running
			if (!instance) {
				instance = await start();
			}
		},

		async onCommand(command: string, args: string[]) {
			switch (command) {
				case "start":
					if (instance) return "Already running";
					instance = await start();
					return "FairygitMother node started";

				case "stop":
					if (!instance) return "Not running";
					await instance.stop();
					instance = null;
					return "FairygitMother node stopped";

				case "status":
					return instance ? "Running" : "Stopped";

				default:
					return `Unknown command: ${command}`;
			}
		},
	};
}
