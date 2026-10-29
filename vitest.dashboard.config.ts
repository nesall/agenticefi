import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
export default defineConfig({
	resolve: {
		alias: { '$app/paths': fileURLToPath(new URL('./tests/mocks/appPaths.ts', import.meta.url)) }
	},
	plugins: [svelte({ compilerOptions: { runes: true } })],
	test: { environment: 'node', include: ['tests/dashboardComponents.ui.ts'] }
});
