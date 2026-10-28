import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
	loadSmokeDataset,
	smokeSelection,
	SmokeDatasetUnavailable,
	SmokeResourceUnavailable
} from './live/analyticalSmokeDatasets';

describe('analytical live dataset selection (offline)', () => {
	it('defaults to April V1 and generates distinct dataset/profile reports', () => {
		expect(smokeSelection()).toMatchObject({
			dataset: 'april',
			profile: 'v1',
			version: 'steady-afr-ve-v1',
			reportPath: 'reports/analytical-tools/april-v1-live-smoke.json'
		});
		const paths = ['april', 'july', 'august', 'august1'].flatMap((dataset) =>
			['v1', 'v2'].map((profile) => smokeSelection(dataset, profile).reportPath)
		);
		expect(new Set(paths).size).toBe(8);
		expect(smokeSelection('july', 'v2').version).toBe('steady-afr-ve-v2-experimental');
	});
	it.each(['aug', 'august8'])('resolves %s to August 8 block2, never August 1', (alias) => {
		expect(smokeSelection(alias)).toEqual(smokeSelection('august'));
		expect(smokeSelection(alias).sources.log).toContain('block2/2026-08-08');
	});
	it.each([
		['../july', 'v1'],
		['unknown', 'v1'],
		['april', 'v3'],
		['april', '../v1']
	])('rejects unsafe or unknown selection %s %s', (dataset, profile) => {
		expect(() => smokeSelection(dataset, profile)).toThrow(/Unknown/);
	});
	it('loads bundled April and the confirmed block1 July calibration with correct decoding', () => {
		const april = loadSmokeDataset(smokeSelection());
		const july = loadSmokeDataset(smokeSelection('july', 'v2'));
		expect(april.logName).toBe('2025-04-12_16.16.28.msl');
		expect(july.logName).toBe('2026-07-25_17.56.47.msl');
		expect(july.profile).toEqual({ version: 'steady-afr-ve-v2-experimental' });
		expect(july.calibrationId).toBe('block1-calibration');
		expect(july.veXml).toBe(april.veXml);
		expect(july.afrXml).toBe(april.afrXml);
		expect(july.logContent).toContain('°F');
		expect(july.calibrationSemantics).toBe('rpm-map-kpa-afr');
	});
	it('binds August 8 to its local block2 VE and AFR, rather than block1', () => {
		const sources = smokeSelection('august').sources;
		expect(sources.calibrationId).toBe('block2-calibration');
		for (const path of [sources.log, sources.ve, sources.afr])
			expect(path && existsSync(path)).toBe(true);
		expect(sources.ve).toContain('block2/veTable1_2026-08-08');
		expect(sources.afr).toContain('block2/AFR_2026-07-30');
		expect(sources.afr).not.toBe(smokeSelection().sources.afr);
	});
	it('blocks missing August 1 AFR before loading telemetry or starting the model', () => {
		expect(smokeSelection('august1').sources.afr).toBeNull();
		expect(() => loadSmokeDataset(smokeSelection('august1'))).toThrow(SmokeDatasetUnavailable);
		expect(() => loadSmokeDataset(smokeSelection('august1'))).toThrow(/No calibration substituted/);
	});
	it('chooses the measured bounded memory tier without changing eligibility selection', () => {
		expect(smokeSelection().workerHeapMb).toBe(512);
		expect(smokeSelection('july', 'v1').workerHeapMb).toBe(512);
		expect(smokeSelection('august', 'v1').workerHeapMb).toBe(1024);
		expect(smokeSelection('aug', 'v2').workerHeapMb).toBe(1024);
		expect(smokeSelection('july', 'v1', '1024').workerHeapMb).toBe(1024);
		expect(() => smokeSelection('august', 'v1', '2048')).toThrow(/Worker heap/);
		expect(() => loadSmokeDataset(smokeSelection('august', 'v1', '512'))).toThrow(
			SmokeResourceUnavailable
		);
	});
	it('documents CLI options without invoking Vitest or making live requests', () => {
		const result = spawnSync(process.execPath, ['scripts/run-analytical-smoke.mjs', '--help'], {
			encoding: 'utf8'
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('--dataset april|july|august|august1 --profile v1|v2');
		expect(result.stdout).toContain('--resilient');
		expect(result.stdout).toContain('--worker-heap-mb');
		expect(result.stdout).not.toContain('RUN  v');
	});
	it.each([['--bogus'], ['--dataset'], ['--profile', 'v1', '--profile', 'v2']])(
		'rejects malformed CLI args before spawning Vitest: %j',
		(...args) => {
			const result = spawnSync(process.execPath, ['scripts/run-analytical-smoke.mjs', ...args], {
				encoding: 'utf8'
			});
			expect(result.status).toBe(1);
			expect(result.stderr.length).toBeGreaterThan(0);
			expect(result.stdout).not.toContain('RUN  v');
		}
	);
	it('supervises a mocked subprocess crash and replaces stale latest success with an honest fallback', () => {
		const directory = mkdtempSync(join(tmpdir(), 'agenticefi-crash-report-'));
		try {
			const preload = join(directory, 'mock-subprocess.cjs');
			writeFileSync(
				preload,
				"require('node:child_process').spawnSync = () => ({ status: 134, signal: null }); require('node:module').syncBuiltinESMExports();"
			);
			const latest = join(directory, 'reports/analytical-tools/july-v1-live-smoke.json');
			mkdirSync(join(directory, 'reports/analytical-tools'), { recursive: true });
			writeFileSync(latest, '{"reportId":"old","outcome":"passed"}');
			const launcher = fileURLToPath(
				new URL('../scripts/run-analytical-smoke.mjs', import.meta.url)
			);
			const result = spawnSync(
				process.execPath,
				['--require', preload, launcher, '--dataset', 'july'],
				{ cwd: directory, encoding: 'utf8' }
			);
			expect(result.status).toBe(134);
			const report = JSON.parse(readFileSync(latest, 'utf8'));
			expect(report).toMatchObject({
				outcome: 'harness-process-failure',
				subprocess: { exitCode: 134 },
				requests: null,
				usage: { status: 'unavailable', totalTokens: null }
			});
			expect(report.reportId).not.toBe('old');
			expect(result.stderr).toContain('Saved reports/analytical-tools/july-v1-live-smoke-');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
