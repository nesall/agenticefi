import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { releaseArchive } from '../scripts/release-archive.mjs';
import { mandatory, sha256, verifyRelease, dependencyOwner } from '../deploy/verify-release.mjs';

describe('release packaging and deployment guardrails', () => {
	it('creates reproducible, extractable archives with long dependency paths and rejects traversal', async () => {
		const parent = realpathSync(tmpdir()),
			root = mkdtempSync(join(parent, 'agenticefi-archive-'));
		try {
			const name = 'node_modules/@lucide/svelte/dist/icons/' + 'x'.repeat(70) + '.js';
			mkdirSync(dirname(join(root, name)), { recursive: true });
			writeFileSync(join(root, name), 'synthetic');
			writeFileSync(join(root, 'package.json'), '{}');
			await releaseArchive(root, [name, 'package.json'], join(root, 'a.tar.gz'));
			await releaseArchive(root, ['package.json', name], join(root, 'b.tar.gz'));
			expect(sha256(readFileSync(join(root, 'a.tar.gz')))).toBe(
				sha256(readFileSync(join(root, 'b.tar.gz')))
			);
			expect(execFileSync('tar', ['-tzf', join(root, 'a.tar.gz')], { encoding: 'utf8' })).toContain(
				name
			);
			await expect(releaseArchive(root, ['../private'], join(root, 'bad.tar.gz'))).rejects.toThrow(
				'Unsafe archive path'
			);
		} finally {
			assert.equal(dirname(root), parent, 'Unsafe test cleanup');
			rmSync(root, { recursive: true, force: true });
		}
	});
	it('verifies the full file inventory and refuses missing, changed or unapproved files', () => {
		const parent = realpathSync(tmpdir()),
			root = mkdtempSync(join(parent, 'agenticefi-integrity-'));
		try {
			const files: Record<string, { bytes: number; sha256: string }> = {};
			for (const path of [...mandatory, 'build/client/_app/immutable/test.js']) {
				const content = path === 'package-lock.json' ? '{"packages":{}}' : '{}';
				mkdirSync(dirname(join(root, path)), { recursive: true });
				writeFileSync(join(root, path), content);
				files[path] = { bytes: Buffer.byteLength(content), sha256: sha256(Buffer.from(content)) };
			}
			const save = () =>
				writeFileSync(
					join(root, 'release-manifest.json'),
					JSON.stringify({ version: 1, releaseId: 'test', files })
				);
			save();
			expect(verifyRelease(root).releaseId).toBe('test');
			writeFileSync(join(root, '.env'), 'not-a-secret');
			expect(() => verifyRelease(root)).toThrow('inventory');
			files['.env'] = { bytes: 12, sha256: sha256(Buffer.from('not-a-secret')) };
			save();
			expect(() => verifyRelease(root)).toThrow('Unapproved');
			rmSync(join(root, '.env'));
			delete files['.env'];
			save();
			writeFileSync(join(root, 'build/index.js'), 'changed');
			expect(() => verifyRelease(root)).toThrow('integrity mismatch');
			expect(dependencyOwner('node_modules/svelte/node_modules/magic-string/package.json')).toBe(
				'node_modules/svelte/node_modules/magic-string'
			);
		} finally {
			assert.equal(dirname(root), parent, 'Unsafe test cleanup');
			rmSync(root, { recursive: true, force: true });
		}
	});
	it('limits the real expensive POST routes without charging polling/cancellation/downloads', () => {
		const config = readFileSync('deploy/nginx-https.conf', 'utf8'),
			limits = readFileSync('deploy/nginx-limits.conf', 'utf8');
		expect(readFileSync('deploy/drain.sh', 'utf8')).not.toContain('\r');
		expect(limits).toMatch(/default "";\s+POST \$binary_remote_addr;/);
		const patterns = [...config.matchAll(/location ~ (\^\/api\/[^ ]+) \{/g)].map(
			(m) => new RegExp(m[1])
		);
		for (const path of ['/api/investigations', '/api/investigations/', '/api/demo', '/api/demo/'])
			expect(patterns.some((p) => p.test(path))).toBe(true);
		for (const path of [
			'/api/investigations/job',
			'/api/investigations/job/cancel',
			'/api/investigations/job/ve-export',
			'/api/sessions/id/telemetry'
		])
			expect(patterns.some((p) => p.test(path))).toBe(false);
		expect(config).toContain('if (-f /etc/nginx/agenticefi-maintenance) { return 503; }');
		expect(config).toContain('auth_basic_user_file');
		expect(config).toContain('proxy_set_header Authorization "";');
		expect(readFileSync('src/routes/api/investigations/+server.ts', 'utf8')).toContain(
			'export const POST'
		);
		expect(readFileSync('src/routes/api/demo/+server.ts', 'utf8')).toContain('export const POST');
	});
});
