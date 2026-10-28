import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { decodeMsl } from '../../src/lib/server/msl/decodeMsl';
import { AnalyticalRun } from '../../src/lib/server/investigation/analyticalRun';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import { analyticalTools } from '../../src/lib/server/investigation/analyticalProtocol';
import { veContentHash } from '../../src/lib/server/analysis/veArtifacts';
import { fitVeCorrections } from '../../src/lib/server/analysis/fitVeCorrections';
import type { AnalyticalInput } from '../../src/lib/server/investigation/analyticalSettings';
import type { AnalyticalEvidenceRef } from '../../src/lib/shared/types/analyticalInvestigation';
import type { ToolResult, InvestigationModel } from '../../src/lib/shared/types/investigation';
import type { VeEvaluationDataset } from '../../src/lib/shared/types/veEvaluation';
import { context, scripted, tool, final } from './helpers';

const table = (value: number) =>
	`<tableData><table cols="2" rows="2"><xAxis cols="2" name="rpm">1000 2000</xAxis><yAxis rows="2" name="fuelload">40 80</yAxis><zValues cols="2" rows="2">${Array(4).fill(value).join(' ')}</zValues></table></tableData>`;
function input(episodes = 20): AnalyticalInput {
	const rows = Array.from({ length: episodes * 71 }, (_, row) => {
		const episode = Math.floor(row / 71),
			cell = episode % 4;
		return [
			episode * 20 + (row % 71) / 10,
			cell % 2 ? 2000 : 1000,
			cell < 2 ? 40 : 80,
			episode < 14 ? 14.28 : 14,
			185,
			100,
			10,
			0,
			0,
			3,
			'Inactive',
			'Inactive'
		].join('\t');
	});
	return {
		contextId: 'synthetic',
		logName: 'synthetic.msl',
		calibrationId: 'confirmed-test',
		calibrationSemantics: 'rpm-map-kpa-afr',
		veXml: table(100),
		afrXml: table(14),
		logContent:
			'Time\tRPM\tMAP\tAFR\tCLT\tFuel: Warmup cor\tTPS\tTPSdot\tMAPdot\tPW\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\ns\trpm\tkPa\tAFR\t°F\t%\t%\t%/s\tkPa/s\tms\t\t\n' +
			rows.join('\n')
	};
}
const runs: AnalyticalRun[] = [];
function run(value = input()) {
	const state = new AnalyticalRun(value);
	runs.push(state);
	return state;
}
function data(result: ToolResult): Record<string, unknown> {
	expect(result.ok, result.ok ? '' : result.error).toBe(true);
	if (!result.ok) throw new Error(result.error);
	return result.data as Record<string, unknown>;
}
const call = (state: AnalyticalRun, name: string, args: unknown = {}, id = 'evidence-1') =>
	state.executeTool(name, args, id);
afterEach(async () => {
	await Promise.all(runs.splice(0).map((r) => r.dispose()));
});

describe('bounded analytical tools and frozen state', () => {
	it('fits lazily, reuses deterministic evidence, and reports worsened holdout results', async () => {
		const state = run();
		const fitted = data(await call(state, 'fit_ve_candidate'));
		expect(fitted.status).toBe('candidate');
		const again = data(
			await call(state, 'fit_ve_candidate', { cells: [{ rpmIndex: 0, mapIndex: 0 }] }, 'evidence-2')
		);
		expect(again.candidateRef).toBe(fitted.candidateRef);
		const analyzed = data(
			await call(
				state,
				'analyze_afr_error',
				{ neighborhoods: [{ rpmIndex: 0, mapIndex: 0 }] },
				'evidence-3'
			)
		);
		expect(analyzed.analysisRef).toBe(fitted.analysisRef);
		const full = (await state.getEvidence(
			analyzed.fullEvidenceRef as AnalyticalEvidenceRef
		)) as VeEvaluationDataset;
		expect(veContentHash(full)).toBe((analyzed.fullEvidenceRef as AnalyticalEvidenceRef).sha256);
		const direct = fitVeCorrections(full);
		expect(await state.getEvidence(fitted.fullEvidenceRef as AnalyticalEvidenceRef)).toEqual(
			direct
		);
		const evaluated = data(
			await call(
				state,
				'evaluate_ve_candidate',
				{ candidateRef: fitted.candidateRef },
				'evidence-4'
			)
		);
		const paired = evaluated.paired as {
			rowCount: number;
			baseline: { mae: number };
			candidate: { mae: number };
			predictedDeltaMae: number;
		};
		expect(paired.candidate.mae).toBeGreaterThan(paired.baseline.mae);
		expect(paired.predictedDeltaMae).toBeGreaterThan(0);
		expect(paired.rowCount).toBe(full.coverage.holdoutRows);
		expect(Buffer.byteLength(JSON.stringify(evaluated))).toBeLessThanOrEqual(
			state.settings.limits.maxResponseBytes
		);
		const cached = data(
			await call(
				state,
				'evaluate_ve_candidate',
				{ candidateRef: fitted.candidateRef },
				'evidence-5'
			)
		);
		expect(cached.fullEvidenceRef).toEqual(evaluated.fullEvidenceRef);
	});
	it('freezes caller settings and raw input at construction', async () => {
		const source = input();
		source.fitting = { huberThreshold: 0.02 };
		const state = run(source);
		source.fitting.huberThreshold = 1;
		source.logContent = 'changed';
		source.afrXml = table(100);
		expect(state.settings.fitting.huberThreshold).toBe(0.02);
		expect(() => {
			(state as unknown as { settings: unknown }).settings = {};
		}).toThrow();
		expect(() => {
			(state.settings.fitting as { huberThreshold: number }).huberThreshold = 1;
		}).toThrow();
		const fitted = data(await call(state, 'fit_ve_candidate'));
		const full = (await state.getEvidence(fitted.fullEvidenceRef as AnalyticalEvidenceRef)) as {
			config: { huberThreshold: number };
		};
		expect(full.config.huberThreshold).toBe(0.02);
	});
	it('rejects cross-run, wrong-kind, and forged evidence references', async () => {
		const a = run(),
			b = run();
		const fit = data(await call(a, 'fit_ve_candidate'));
		expect((await call(b, 'evaluate_ve_candidate', { candidateRef: fit.candidateRef })).ok).toBe(
			false
		);
		expect((await call(a, 'evaluate_ve_candidate', { candidateRef: fit.analysisRef })).ok).toBe(
			false
		);
		expect((await call(b, 'fit_ve_candidate', { analysisRef: fit.analysisRef })).ok).toBe(false);
		await expect(b.getEvidence(fit.fullEvidenceRef as AnalyticalEvidenceRef)).rejects.toThrow();
		await expect(
			a.getEvidence({ ...(fit.fullEvidenceRef as AnalyticalEvidenceRef), sha256: 'forged' })
		).rejects.toThrow(/provenance/);
	});
	it.each([
		['analyze_afr_error', { fitting: { maxCorrectionPct: 20 } }],
		['fit_ve_candidate', { corrections: [] }],
		['fit_ve_candidate', { profile: 'v2' }],
		['analyze_afr_error', { rowIndices: [1, 1] }],
		['analyze_afr_error', { neighborhoods: [{ rpmIndex: 1.5, mapIndex: 0 }] }],
		['fit_ve_candidate', { cells: Array(9).fill({ rpmIndex: 0, mapIndex: 0 }) }],
		['evaluate_ve_candidate', {}],
		['apply_ecu', {}]
	])('rejects unsafe or invalid tool arguments: %s %j', async (name, args) => {
		expect((await call(run(), String(name), args)).ok).toBe(false);
	});
	it('rejects actual-axis mistakes before fitting and preserves region/row provenance', async () => {
		const state = run();
		expect(
			(await call(state, 'fit_ve_candidate', { cells: [{ rpmIndex: 99, mapIndex: 0 }] })).ok
		).toBe(false);
		const a = data(
			await call(
				state,
				'analyze_afr_error',
				{ neighborhoods: [{ rpmIndex: 0, mapIndex: 0 }] },
				'evidence-2'
			)
		);
		const dataset = (await state.getEvidence(
			a.fullEvidenceRef as AnalyticalEvidenceRef
		)) as VeEvaluationDataset;
		const rows = a.supportingRows as { rowIndex: number; partition: string }[];
		expect(rows.every((row) => row.partition === 'training')).toBe(true);
		expect(
			(await call(state, 'analyze_afr_error', { rowIndices: [dataset.split.holdout!.startRow] })).ok
		).toBe(false);
		const picked = data(
			await call(
				state,
				'analyze_afr_error',
				{ rowIndices: [dataset.split.training!.startRow] },
				'evidence-3'
			)
		);
		expect((picked.supportingRows as { rowIndex: number }[])[0].rowIndex).toBe(
			dataset.split.training!.startRow
		);
	});
	it.each(['afrXml', 'veXml', 'calibrationSemantics'] as const)(
		'reports missing %s without substitutions',
		async (key) => {
			const source = input();
			delete source[key];
			const state = run(source);
			const result = data(await call(state, 'fit_ve_candidate'));
			expect(result.status).toBe('unavailable');
			expect(result.candidateRef).toBeUndefined();
			const full = (await state.getEvidence(result.fullEvidenceRef as AnalyticalEvidenceRef)) as {
				missing: string[];
			};
			expect(full.missing.length).toBeGreaterThan(0);
			expect((await call(state, 'describe_log', {}, 'evidence-2')).ok).toBe(true);
		}
	);
	it('supports no-correction candidates and unchanged paired outcomes', async () => {
		const state = run(input(5));
		const fit = data(await call(state, 'fit_ve_candidate'));
		expect(fit.status).toBe('no-supported-proposal');
		const evaluated = data(
			await call(state, 'evaluate_ve_candidate', { candidateRef: fit.candidateRef }, 'evidence-2')
		);
		expect((evaluated.paired as { predictedDeltaMae: number }).predictedDeltaMae).toBe(0);
	});
	it('enforces row, artifact, response, timeout, and cancellation bounds', async () => {
		const capped = run();
		for (let i = 0; i < 21; i++) expect((await call(capped, 'unknown')).ok).toBe(false);
		expect(capped.manifest.timings).toHaveLength(20);
		const dimension = run({ ...input(), limits: { maxRows: 1 } });
		expect((await call(dimension, 'fit_ve_candidate')).ok).toBe(false);
		await dimension.dispose();
		const artifact = run({ ...input(), limits: { maxArtifactBytes: 1 } });
		expect((await call(artifact, 'fit_ve_candidate')).ok).toBe(false);
		await artifact.dispose();
		const timed = run({ ...input(), limits: { jobTimeoutMs: 1 } });
		expect((await call(timed, 'fit_ve_candidate')).ok).toBe(false);
		await timed.dispose();
		const cancelled = run();
		const controller = new AbortController();
		const job = cancelled.executeTool('fit_ve_candidate', {}, 'evidence-1', controller.signal);
		controller.abort();
		expect((await job).ok).toBe(false);
		await cancelled.dispose();
		const response = run({ ...input(), limits: { maxResponseBytes: 1024 } });
		expect((await call(response, 'describe_log')).ok).toBe(false);
	});
	it('validates caller resource and numerical settings before spawning', () => {
		expect(run().settings.workerHeapMb).toBe(512);
		expect(() => run({ ...input(), limits: { maxResponseBytes: 1 } })).toThrow();
		expect(() => run({ ...input(), limits: { maxRows: 60001 } })).toThrow();
		expect(() => run({ ...input(), fitting: { maxIterations: 5001 } })).toThrow();
		expect(() => run({ ...input(), preparation: { trainingFraction: 2 } })).toThrow();
	});
	it('freezes the explicit 1 GiB worker tier and preserves numerical defaults', async () => {
		const source = { ...input(), workerHeapMb: 1024 as const };
		const expanded = run(source);
		const standard = run();
		expect(expanded.settings.workerHeapMb).toBe(1024);
		expect(expanded.settings.profile).toEqual(standard.settings.profile);
		expect(expanded.settings.preparation).toEqual(standard.settings.preparation);
		expect(expanded.settings.fitting).toEqual(standard.settings.fitting);
		expect(expanded.settings.limits).toEqual(standard.settings.limits);
		expect(expanded.settingsId).not.toBe(standard.settingsId);
		const result = data(await call(expanded, 'fit_ve_candidate'));
		expect(result.status).toBe('candidate');
	});
	it.each([0, 256, 768, 2048, Number.NaN])('rejects unsupported worker heap %s', (workerHeapMb) => {
		expect(() => run({ ...input(), workerHeapMb } as AnalyticalInput)).toThrow(/worker heap/);
	});
	it('interrupts an initialized worker during numerical preparation', async () => {
		const state = run({
			contextId: 'cancel-in-flight',
			logName: 'rx7.msl',
			logContent: readFileSync('src/lib/server/demo/rx7.msl', 'utf8'),
			calibrationId: 'confirmed-block1',
			calibrationSemantics: 'rpm-map-kpa-afr',
			veXml: readFileSync('src/lib/server/demo/ve.table', 'utf8'),
			afrXml: readFileSync('src/lib/server/demo/afr.table', 'utf8')
		});
		const described = data(await call(state, 'describe_log'));
		const controller = new AbortController(),
			start = performance.now();
		const pending = state.executeTool('fit_ve_candidate', {}, 'evidence-2', controller.signal);
		const timer = setTimeout(() => controller.abort(), 20);
		try {
			expect((await pending).ok).toBe(false);
			expect(performance.now() - start).toBeLessThan(2000);
			await expect(
				state.getEvidence(described.fullEvidenceRef as AnalyticalEvidenceRef)
			).rejects.toThrow();
		} finally {
			clearTimeout(timer);
		}
	}, 20000);
	it('expires evidence and caps live workers', async () => {
		const a = run(),
			b = run(),
			c = run();
		await call(a, 'describe_log');
		await call(b, 'describe_log');
		expect((await call(c, 'describe_log')).ok).toBe(false);
		await a.dispose();
		await b.dispose();
		await c.dispose();
		const expiring = run({ ...input(), limits: { retentionMs: 30 } });
		const result = data(await call(expiring, 'describe_log'));
		await new Promise((resolve) => setTimeout(resolve, 80));
		await expect(
			expiring.getEvidence(result.fullEvidenceRef as AnalyticalEvidenceRef)
		).rejects.toThrow();
	});
});

describe('analytical model orchestration and authoritative facts', () => {
	it('allows fit-first investigation and keeps commentary distinct from mandatory numerical outcomes', async () => {
		const state = run();
		let turn = 0;
		const model: InvestigationModel = {
			async next(incoming) {
				expect(incoming.reportMode).toBe('analytical');
				expect(incoming.tools).toEqual(analyticalTools);
				if (turn++ === 0) return tool('fit_ve_candidate');
				const fitted = data(incoming.trace[0].result);
				if (turn === 2) return tool('evaluate_ve_candidate', { candidateRef: fitted.candidateRef });
				(data(incoming.trace[0].result).facts as { statement: string }[])[0].statement =
					'Forged measured improvement';
				// A model can discuss a hypothesis but cannot supply authoritative findings.
				return {
					kind: 'final',
					factIds: [],
					commentary: [
						{
							kind: 'hypothesis',
							text: 'Sensor delay might contribute; this is unverified.',
							evidenceIds: ['evidence-1', 'evidence-2']
						}
					]
				};
			}
		};
		const result = await runInvestigation(state, model, { goal: 'Investigate AFR error.' });
		expect(result.status).toBe('completed');
		expect(result.report!.advisoryOnly).toBe(true);
		expect(result.report!.findings.some((f) => f.statement.includes('MAE'))).toBe(true);
		expect(result.report!.findings.every((f) => f.verification === 'server-numerical')).toBe(true);
		expect(result.report!.findings.some((f) => f.statement.includes('Forged'))).toBe(false);
		expect(result.report!.commentary![0].verification).toBe('unverified-model-commentary');
		expect(result.analytical!.evidenceRefs.length).toBeGreaterThan(0);
		await expect(runInvestigation(state, model, { goal: 'Reuse' })).rejects.toThrow(
			/new AnalyticalRun/
		);
	});
	it('rejects fake facts and model-authored authoritative claims', async () => {
		const state = run();
		const result = await runInvestigation(
			state,
			scripted(tool('fit_ve_candidate'), {
				kind: 'final',
				factIds: ['other-run:fact'],
				commentary: []
			}),
			{ goal: 'Inspect' }
		);
		expect(result.status).toBe('invalid_response');
		await state.dispose();
		const second = await runInvestigation(run(), scripted(tool('describe_log'), final()), {
			goal: 'Inspect'
		});
		expect(second.status).toBe('invalid_response');
	});
	it('completes a missing-calibration investigation with a verified limitation', async () => {
		const source = input();
		delete source.afrXml;
		const result = await runInvestigation(
			run(source),
			scripted(tool('fit_ve_candidate'), { kind: 'final', factIds: [], commentary: [] }),
			{ goal: 'Inspect' }
		);
		expect(result.status).toBe('completed');
		expect(result.report!.findings[0].statement).toContain('unavailable');
	});
	it('preserves the legacy dashboard report shape and registry', async () => {
		const result = await runInvestigation(context(), scripted(tool('describe_log'), final()), {
			goal: 'Inspect'
		});
		expect(result.status).toBe('completed');
		expect(result.analytical).toBeUndefined();
		expect(result.report!.commentary).toBeUndefined();
	});
	it('times out or cancels an investigation without blocking the event loop', async () => {
		const state = run();
		const started = performance.now();
		let heartbeat = false;
		setTimeout(() => {
			heartbeat = true;
		}, 5);
		const result = await runInvestigation(state, scripted(tool('fit_ve_candidate')), {
			goal: 'Inspect',
			timeoutMs: 20
		});
		expect(result.status).toBe('timeout');
		expect(heartbeat).toBe(true);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

it('benchmarks isolated real-log execution and retains full provenance', async () => {
	const files =
		process.env.WRITE_ANALYTICAL_BENCHMARK === '1'
			? ['2025-04-12_16.16.28.msl', '2026-07-25_17.56.47.msl']
			: ['2025-04-12_16.16.28.msl'];
	const measurements = [];
	for (const file of files) {
		const version = file.startsWith('2025') ? 'steady-afr-ve-v1' : 'steady-afr-ve-v2-experimental';
		const state = run({
			contextId: file,
			logName: file,
			logContent: decodeMsl(readFileSync(`data/logs/block1/${file}`)).content,
			calibrationId: 'confirmed-block1',
			calibrationSemantics: 'rpm-map-kpa-afr',
			veXml: readFileSync('src/lib/server/demo/ve.table', 'utf8'),
			afrXml: readFileSync('src/lib/server/demo/afr.table', 'utf8'),
			profile: { version }
		});
		let ticks = 0,
			maximumTickGapMs = 0,
			lastTick = performance.now();
		const start = lastTick;
		const timer = setInterval(() => {
			const now = performance.now();
			maximumTickGapMs = Math.max(maximumTickGapMs, now - lastTick);
			lastTick = now;
			ticks++;
		}, 10);
		try {
			const fitted = data(await call(state, 'fit_ve_candidate'));
			await call(
				state,
				'evaluate_ve_candidate',
				{ candidateRef: fitted.candidateRef },
				'evidence-2'
			);
			expect(ticks).toBeGreaterThan(5);
			expect(state.manifest.timings).toHaveLength(2);
			measurements.push({
				file,
				version,
				totalWallMs: performance.now() - start,
				mainLoopTicks: ticks,
				maximumTickGapMs,
				timings: state.manifest.timings
			});
		} finally {
			clearInterval(timer);
			await state.dispose();
		}
	}
	if (process.env.WRITE_ANALYTICAL_BENCHMARK === '1') {
		mkdirSync('reports/analytical-tools', { recursive: true });
		writeFileSync(
			'reports/analytical-tools/worker-benchmark.json',
			JSON.stringify(measurements, null, 2)
		);
	}
}, 60000);
