import { describe, expect, it, vi } from 'vitest';
import { DashboardStore } from '../src/lib/server/sessionStore';
import { curatedDemo, demoCatalog, demoId } from '../src/lib/server/demo/catalog';
import { projectRecording } from '../src/lib/server/recordedInvestigation';
import type { InvestigationModel, JsonValue } from '../src/lib/shared/types/investigation';
import { context } from './investigation/helpers';
import {
	InvestigationDiagnostics,
	InvestigationFailure
} from '../src/lib/server/investigation/diagnostics';

const obj = (v: JsonValue) => v as Record<string, JsonValue>;
function analyticalModel(): InvestigationModel {
	return {
		async next(input) {
			if (input.trace.length === 0)
				return { kind: 'tool', name: 'fit_ve_candidate', arguments: {} };
			if (input.trace.length === 1)
				return { kind: 'tool', name: 'analyze_afr_error', arguments: {} };
			if (input.trace.length === 2) {
				const fit = input.trace[0].result;
				return {
					kind: 'tool',
					name: 'evaluate_ve_candidate',
					arguments: { candidateRef: fit.ok ? obj(fit.data).candidateRef : 'missing' }
				};
			}
			const facts = input.trace.flatMap((t) =>
				t.result.ok && Array.isArray(obj(t.result.data).facts)
					? (obj(t.result.data).facts as Record<string, JsonValue>[])
					: []
			);
			return {
				kind: 'final',
				factIds: facts.slice(0, 10).map((f) => f.id),
				commentary: [
					{
						kind: 'limitation',
						text: 'Offline scripted orchestration test; no measured improvement.',
						evidenceIds: ['evidence-1']
					}
				]
			};
		}
	};
}

describe('analytical dashboard orchestration (scripted model, no API)', () => {
	it('loads curated sources once and rejects arbitrary demo paths', async () => {
		expect(demoId(undefined)).toBe('april');
		expect(() => demoId('../logs')).toThrow();
		const [a, b] = await Promise.all([curatedDemo('april'), curatedDemo('april')]);
		expect(a).toBe(b);
		expect(a.context.session.rowCount).toBe(2859);
		expect(demoCatalog().map((d) => d.id)).toEqual(['april', 'august8']);
	});
	it('runs fit-first with frozen V1, retains full cell details, and disposes the worker', async () => {
		let now = Date.now();
		const store = new DashboardStore({
				ttlMs: 30 * 60 * 1000,
				maxSessions: 8,
				maxRuns: 16,
				maxActiveRuns: 2,
				now: () => now
			}),
			demo = await curatedDemo('april');
		const session = store.create('owner', demo.context, 'april');
		const job = store.start(
			'owner',
			session.id,
			{
				mode: 'analytical',
				goal: 'Investigate',
				startSec: session.startSec,
				endSec: session.startSec + 5
			},
			analyticalModel()
		);
		expect(job.source).toBe('live');
		expect(job.profile).toBe('v1');
		expect(job.logName).toBe('2025-04-12_16.16.28.msl');
		expect(job.calibrationId).toBe('block1-calibration');
		expect(job.rowCount).toBe(2859);
		expect(() => store.job('other', job.id)).toThrow('unavailable');
		await vi.waitFor(() => expect(store.job('owner', job.id).state).toBe('finished'), {
			timeout: 12000
		});
		const result = store.job('owner', job.id);
		expect(result.error).toBeNull();
		expect(result.veExport?.available).toBe(true);
		const exported = store
			.downloadVe('owner', job.id, 'csv')
			.body.trim()
			.split('\r\n')
			.slice(1)
			.map((row) => row.split(',').slice(1).map(Number));
		for (const cell of result.presentation!.cells)
			expect(exported[cell.mapIndex][cell.rpmIndex]).toBe(cell.proposedVe);
		expect(() => store.downloadVe('other', job.id, 'csv')).toThrow('unavailable');
		expect(JSON.parse(store.downloadVe('owner', job.id, 'json').body)).toMatchObject({
			investigation: 'completed',
			evaluation: 'held-out conditional model predictions available'
		});
		expect(result.result?.status).toBe('completed');
		expect(result.presentation?.cells).toHaveLength(256);
		expect(result.presentation?.veAxes?.rpm).toHaveLength(16);
		expect(result.presentation?.veAxes?.mapKpa).toHaveLength(16);
		for (const cell of result.presentation!.cells) {
			expect(result.presentation!.veAxes!.rpm[cell.rpmIndex]).toBe(cell.rpm);
			expect(result.presentation!.veAxes!.mapKpa[cell.mapIndex]).toBe(cell.mapKpa);
		}
		expect(
			result.presentation?.cells.every(
				(c) =>
					c.status === 'unsupported' && c.originalVe === c.proposedVe && c.finalCorrectionPct === 0
			)
		).toBe(true);
		expect(result.presentation?.paired?.candidate?.mae).toBe(
			result.presentation?.paired?.baseline.mae
		);
		expect(result.presentation?.regions[0].samples.length).toBeGreaterThan(0);
		expect(result.progress?.completed).toHaveLength(3);
		expect(JSON.stringify(result.presentation)).not.toContain('logContent');
		expect(Buffer.byteLength(JSON.stringify(result.presentation))).toBeLessThan(512 * 1024);
		// A second run can acquire a worker after the first completes.
		const next = store.start(
			'owner',
			session.id,
			{
				mode: 'analytical',
				goal: 'Again',
				startSec: session.startSec,
				endSec: session.startSec + 1
			},
			analyticalModel()
		);
		await vi.waitFor(() => expect(store.job('owner', next.id).state).toBe('finished'), {
			timeout: 12000
		});
		expect(store.job('owner', next.id).error).toBeNull();
		now += 30 * 60 * 1000 + 1;
		expect(() => store.downloadVe('owner', job.id, 'csv')).toThrow('unavailable');
	});
	it('publishes completed calls while waiting for Muse, enforces capacity, and cancels by owner', async () => {
		const store = new DashboardStore(),
			demo = await curatedDemo('april');
		const session = store.create('owner', demo.context, 'april');
		const paused: InvestigationModel = {
			next: async ({ trace }) =>
				trace.length ? new Promise(() => {}) : { kind: 'tool', name: 'describe_log', arguments: {} }
		};
		const job = store.start(
			'owner',
			session.id,
			{ mode: 'analytical', goal: 'Pause', startSec: session.startSec, endSec: session.endSec },
			paused
		);
		try {
			await vi.waitFor(
				() => expect(store.job('owner', job.id).progress?.completed.length).toBe(1),
				{ timeout: 5000 }
			);
			expect(store.job('owner', job.id).progress?.phase).toBe('awaiting-model');
			expect(() => store.cancel('other', job.id)).toThrow('unavailable');
			const other = store.create('second', demo.context, 'april');
			expect(() =>
				store.start(
					'second',
					other.id,
					{ mode: 'analytical', goal: 'Blocked', startSec: other.startSec, endSec: other.endSec },
					analyticalModel()
				)
			).toThrow('One analytical');
		} finally {
			store.cancel('owner', job.id);
		}
		await vi.waitFor(() => expect(store.job('owner', job.id).state).toBe('finished'));
		expect(store.job('owner', job.id).result?.status).toBe('cancelled');
	});
	it('preserves partial evidence when the agent omits required analytical stages', async () => {
		const store = new DashboardStore(),
			demo = await curatedDemo('april'),
			session = store.create('o', demo.context, 'april');
		const model: InvestigationModel = {
			next: async ({ trace }) =>
				trace.length
					? { kind: 'final', factIds: [], commentary: [] }
					: { kind: 'tool', name: 'describe_log', arguments: {} }
		};
		const job = store.start(
			'o',
			session.id,
			{ mode: 'analytical', goal: 'Partial', startSec: session.startSec, endSec: session.endSec },
			model
		);
		await vi.waitFor(() => expect(store.job('o', job.id).state).toBe('finished'), {
			timeout: 5000
		});
		expect(store.job('o', job.id).error).toContain('without completing');
		expect(store.job('o', job.id).termination?.code).toBe('incomplete-workflow');
		expect(store.job('o', job.id).presentation?.cells).toHaveLength(0);
	});
	it('retains partial fit results on deadline and never masks timeout with an adapter cancellation', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = new DashboardStore(),
			demo = await curatedDemo('april'),
			session = store.create('owner', demo.context, 'april');
		const diagnostics = new InvestigationDiagnostics({ persist: false });
		let ready!: () => void;
		const waiting = new Promise<void>((resolve) => (ready = resolve));
		const model: InvestigationModel = {
			next: async ({ trace }, signal) => {
				if (!trace.length) return { kind: 'tool', name: 'fit_ve_candidate', arguments: {} };
				ready();
				return new Promise((_, reject) =>
					signal.addEventListener('abort', () =>
						reject(
							new InvestigationFailure(
								'cancelled',
								'Meta request failed (network or cancellation).'
							)
						)
					)
				);
			}
		};
		const job = store.start(
			'owner',
			session.id,
			{ mode: 'analytical', goal: 'inspect', startSec: session.startSec, endSec: session.endSec },
			model,
			() => 'Meta request failed (network or cancellation).',
			diagnostics
		);
		try {
			await waiting;
			await vi.advanceTimersByTimeAsync(120001);
			expect(store.job('owner', job.id).state).toBe('running');
			await vi.advanceTimersByTimeAsync(60000);
			vi.useRealTimers();
			await vi.waitFor(() => expect(store.job('owner', job.id).state).toBe('finished'));
			const result = store.job('owner', job.id);
			expect(result.termination).toMatchObject({ code: 'deadline', phase: 'model', modelTurn: 2 });
			expect(result.error).toContain('deadline exceeded');
			expect(result.error).toContain('180 seconds');
			expect(result.error).not.toContain('network');
			expect(result.presentation?.cells).toHaveLength(256);
			expect(result.veExport?.available).toBe(true);
			expect(JSON.parse(store.downloadVe('owner', job.id, 'json').body)).toMatchObject({
				investigation: 'partial',
				evaluation: 'unavailable'
			});
			expect(result.result?.trace[0].result.ok).toBe(true);
			expect(diagnostics.events.at(-1)).toMatchObject({
				event: 'job-end',
				category: 'deadline',
				runnerStatus: 'timeout'
			});
		} finally {
			vi.useRealTimers();
		}
	});
	it('records session expiry separately from user cancellation without exposing owner identity', async () => {
		let now = 1000;
		const store = new DashboardStore({
			ttlMs: 100,
			maxSessions: 8,
			maxRuns: 16,
			maxActiveRuns: 2,
			now: () => now
		});
		const demo = await curatedDemo('april'),
			session = store.create('private-owner', demo.context, 'april');
		const diagnostics = new InvestigationDiagnostics({ persist: false });
		const job = store.start(
			'private-owner',
			session.id,
			{ mode: 'analytical', goal: 'inspect', startSec: session.startSec, endSec: session.endSec },
			{ next: async () => new Promise(() => {}) },
			() => null,
			diagnostics
		);
		now += 101;
		expect(() => store.job('private-owner', job.id)).toThrow('unavailable or expired');
		await vi.waitFor(() => expect(diagnostics.events.at(-1)?.event).toBe('job-end'));
		expect(diagnostics.events.at(-1)?.category).toBe('session-expired');
		expect(JSON.stringify(diagnostics.events)).not.toContain('private-owner');
	});
});

describe('recording validation and honest missing details', () => {
	const fixture = () => ({
		model: 'muse-spark-1.3-contributor',
		outcome: 'passed',
		startedAt: '2026-10-28T09:00:00.000Z',
		selection: {
			dataset: 'april',
			profile: 'v1',
			sources: { log: 'src/lib/server/demo/rx7.msl', calibrationId: 'test-calibration' }
		},
		validatedInvestigation: {
			status: 'completed',
			reason: null,
			trace: [
				{
					tool: 'describe_log',
					evidenceId: 'evidence-1',
					arguments: {},
					result: { ok: true, data: {} }
				}
			],
			report: {
				advisoryOnly: true,
				findings: [
					{
						statement: 'Recorded server fact',
						verification: 'server-numerical',
						evidenceIds: ['evidence-1']
					}
				],
				commentary: [
					{
						kind: 'limitation',
						text: 'Recorded commentary',
						verification: 'unverified-model-commentary',
						evidenceIds: ['evidence-1']
					}
				],
				limitations: ['Historical.']
			}
		}
	});
	it('labels historical evidence and never fabricates omitted cell or holdout data', () => {
		const result = projectRecording(fixture(), 'april', 'v1', context());
		expect(result.recordedAt).toBe('2026-10-28T09:00:00.000Z');
		expect(result.presentation.cells).toEqual([]);
		expect(result.presentation.paired).toBeNull();
		expect(result.presentation.omittedCells).toBe(256);
		expect(result.presentation.limitations.join(' ')).toContain('Historical');
	});
	it('rejects cross-dataset/profile/calibration and invented fact citations', () => {
		expect(() => projectRecording(fixture(), 'august8', 'v1', context())).toThrow();
		expect(() => projectRecording(fixture(), 'april', 'v2-experimental', context())).toThrow();
		const wrong = fixture();
		wrong.selection.sources.calibrationId = 'foreign';
		expect(() => projectRecording(wrong, 'april', 'v1', context())).toThrow();
		const invented = fixture();
		invented.validatedInvestigation.report.findings[0].evidenceIds = ['evidence-99'];
		expect(() => projectRecording(invented, 'april', 'v1', context())).toThrow();
	});
});
