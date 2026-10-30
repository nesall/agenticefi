import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

describe('public August demo assets', () => {
	it('prepares exact original input bytes without private logs or existing caches', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'agenticefi-public-assets-'));
		try {
			mkdirSync(resolve(directory, 'src/lib/server/demo'), { recursive: true });
			cpSync('src/lib/server/demo/august8', resolve(directory, 'src/lib/server/demo/august8'), {
				recursive: true
			});
			execFileSync(process.execPath, [resolve('scripts/build-demo-assets.mjs')], {
				cwd: directory
			});
			const manifest = JSON.parse(
				readFileSync('src/lib/server/demo/august8/manifest.json', 'utf8')
			);
			for (const [name, metadata] of Object.entries(manifest.files) as [
				string,
				{ storage: string; bytes: number; sha256: string }
			][]) {
				const bytes = readFileSync(resolve(directory, '.demo-assets/august8', name));
				expect(bytes.length).toBe(metadata.bytes);
				expect(createHash('sha256').update(bytes).digest('hex')).toBe(metadata.sha256);
				if (metadata.storage.endsWith('.gz')) {
					const compressed = readFileSync('src/lib/server/demo/august8/' + metadata.storage);
					expect(compressed.length).toBeLessThan(5 * 1024 * 1024);
					expect(createHash('sha256').update(gunzipSync(compressed)).digest('hex')).toBe(
						metadata.sha256
					);
				}
			}
		} finally {
			assert.equal(dirname(directory), resolve(tmpdir()), 'Unsafe temporary cleanup path.');
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
