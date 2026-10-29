import { defineConfig } from 'vitest/config';

// One explicitly requested live run, isolated from offline and legacy live tests.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/live/analyticalAgent.live.ts'],
		testTimeout: 200000,
		retry: 0
	}
});
