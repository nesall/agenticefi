import { defineConfig } from 'vitest/config';

// Parser tests run independently of the SvelteKit application and deployment adapter.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts']
	}
});
