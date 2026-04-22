import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: resolve(__dirname),
	resolve: {
		alias: {
			"@": resolve(__dirname, "../src"),
		},
	},
	test: {
		environment: "node",
		globals: true,
		include: ["tests/**/*.test.ts"],
	},
});
