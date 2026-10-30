import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import config from '../vite.config';
import { metaApiKey } from '../src/lib/server/investigation/metaApiKey';

vi.mock('@sveltejs/kit/vite', () => ({ sveltekit: () => [] }));
vi.mock('@tailwindcss/vite', () => ({ default: () => ({ name: 'test-tailwind' }) }));
vi.mock('@sveltejs/adapter-node', () => ({ default: () => ({ name: 'test-node' }) }));

let directory: string;
beforeEach(() => {
	directory = mkdtempSync(resolve(tmpdir(), 'agenticefi-local-env-'));
	vi.spyOn(process, 'cwd').mockReturnValue(directory);
	vi.stubEnv('META_HACKATHON_API_KEY', undefined);
	vi.stubEnv('META_API_KEY', undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (dirname(directory) !== resolve(tmpdir())) throw new Error('Unsafe temporary cleanup path.');
	rmSync(directory, { recursive: true, force: true });
});
async function configure(command: 'serve' | 'build' = 'serve') {
	if (typeof config !== 'function') throw new Error('Expected Vite configuration function.');
	return config({ command, mode: 'development' });
}
describe('server-only local credential initialization', () => {
	it('loads .env and standard .env.local precedence without publishing credentials in config', async () => {
		writeFileSync(
			resolve(directory, '.env'),
			'META_HACKATHON_API_KEY=synthetic-env\nUNRELATED_SECRET=private\n'
		);
		writeFileSync(resolve(directory, '.env.local'), 'META_HACKATHON_API_KEY=synthetic-local\n');
		const result = await configure();
		expect(metaApiKey()).toBe('synthetic-local');
		expect(process.env.UNRELATED_SECRET).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain('synthetic-local');
	});
	it.each(['META_HACKATHON_API_KEY', 'META_API_KEY'])(
		'preserves real process configuration through %s',
		async (name) => {
			writeFileSync(
				resolve(directory, '.env'),
				'META_HACKATHON_API_KEY=synthetic-file\nMETA_API_KEY=synthetic-alias\n'
			);
			vi.stubEnv(name, 'synthetic-process');
			await configure();
			expect(metaApiKey()).toBe('synthetic-process');
		}
	);
	it('loads the fallback alias without replacing an explicitly blank process primary', async () => {
		writeFileSync(
			resolve(directory, '.env'),
			'META_HACKATHON_API_KEY=synthetic-primary\nMETA_API_KEY=synthetic-alias\n'
		);
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		await configure();
		expect(process.env.META_HACKATHON_API_KEY).toBe('');
		expect(metaApiKey()).toBe('synthetic-alias');
	});
	it('does not load dotenv credentials during production builds', async () => {
		writeFileSync(resolve(directory, '.env'), 'META_HACKATHON_API_KEY=synthetic-build\n');
		await configure('build');
		expect(metaApiKey()).toBeUndefined();
	});
});
