import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
	},
	resolve: {
		alias: {
			"@fairygitmother/core": new URL("./packages/core/src", import.meta.url).pathname,
			"@fairygitmother/server": new URL("./packages/server/src", import.meta.url).pathname,
			"@fairygitmother/node": new URL("./packages/node/src", import.meta.url).pathname,
		},
	},
});
