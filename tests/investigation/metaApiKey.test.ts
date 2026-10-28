import { afterEach, describe, expect, it, vi } from 'vitest';
import { metaApiKey } from '../../src/lib/server/investigation/metaApiKey';
import { DashboardStore } from '../../src/lib/server/sessionStore';
import { context } from './helpers';

afterEach(() => vi.unstubAllEnvs());

describe('Muse credential configuration', () => {
	it('supports either name, trims values, and prefers the project-specific key', () => {
		expect(metaApiKey({})).toBeUndefined();
		expect(metaApiKey({ META_API_KEY: ' alias ' })).toBe('alias');
		expect(metaApiKey({ META_HACKATHON_API_KEY: ' primary ', META_API_KEY: 'alias' })).toBe(
			'primary'
		);
		expect(metaApiKey({ META_HACKATHON_API_KEY: ' ', META_API_KEY: 'alias' })).toBe('alias');
		expect(metaApiKey({ META_API_KEY: ' ' })).toBeUndefined();
	});

	it('enables investigation after demo creation with either process credential name', () => {
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		vi.stubEnv('META_API_KEY', 'test-secret');
		const store = new DashboardStore();
		const summary = store.create('owner', context());
		expect(summary.museAvailable).toBe(true);
		expect(JSON.stringify(summary)).not.toContain('test-secret');
		vi.stubEnv('META_API_KEY', '');
		expect(store.summary('owner', summary.id).museAvailable).toBe(false);
		vi.stubEnv('META_HACKATHON_API_KEY', 'project-secret');
		expect(store.summary('owner', summary.id).museAvailable).toBe(true);
	});

	it('refreshes credential availability when reusing a demo session', () => {
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		vi.stubEnv('META_API_KEY', '');
		const store = new DashboardStore();
		const summary = store.create('owner', context());
		expect(summary.museAvailable).toBe(false);
		vi.stubEnv('META_API_KEY', 'configured');
		expect(store.create('owner', context())).toMatchObject({
			id: summary.id,
			museAvailable: true
		});
	});
});
