import { defineConfig } from 'vitest/config';

// Explicit opt-in: these files do not match the normal offline test pattern.
export default defineConfig({
	test: { environment: 'node', include: ['tests/live/**/*.live.ts'], testTimeout: 310000 }
});
