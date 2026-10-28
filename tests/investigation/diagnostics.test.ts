import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	InvestigationDiagnostics,
	InvestigationFailure,
	diagnosticTransport
} from '../../src/lib/server/investigation/diagnostics';
import { retryingTransport } from '../../src/lib/server/investigation/retryTransport';
import { AnalyticalRun } from '../../src/lib/server/investigation/analyticalRun';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import { MetaResponsesModel } from '../../src/lib/server/investigation/metaResponsesModel';
import { investigationStatus } from '../../src/lib/components/dashboard/investigationStatus';
import type { InvestigationJob } from '../../src/lib/shared/types/dashboard';
import type { InvestigationModel } from '../../src/lib/shared/types/investigation';
import { veXml, afrXml } from './helpers';

const jobId = '11111111-1111-4111-8111-111111111111';
const handles: AnalyticalRun[] = [];
const makeRun = (diagnostics?: InvestigationDiagnostics) => {
	const run = new AnalyticalRun(
		{
			contextId: 'diagnostic-test',
			logName: 'synthetic.msl',
			calibrationId: 'confirmed',
			calibrationSemantics: 'rpm-map-kpa-afr',
			veXml,
			afrXml,
			logContent: 'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1000\t50\t14\n1\t1000\t50\t14'
		},
		{ diagnostics, checkpointPresentation: true }
	);
	handles.push(run);
	return run;
};
afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(handles.splice(0).map((r) => r.dispose()));
});

describe('private structured investigation diagnostics', () => {
	it('retains allowlisted rejection details and request ID without provider text or consuming the response', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const body = JSON.stringify({
			error: {
				code: 'invalid_value',
				type: 'invalid_request_error',
				param: 'previous_response_id',
				message: 'previous_response_id invalid: test-secret private telemetry',
				private: 'test-secret'
			}
		});
		const response = new Response(body, {
			status: 400,
			headers: { 'x-request-id': jobId, authorization: 'test-secret' }
		});
		const transport = diagnosticTransport(vi.fn<typeof fetch>().mockResolvedValue(response), d);
		const returned = await transport('https://example.invalid');
		expect(await returned.text()).toBe(body);
		expect(d.events.at(-1)).toMatchObject({
			status: 400,
			providerErrorCode: 'invalid_value',
			providerErrorType: 'invalid_request_error',
			providerErrorParam: 'previous_response_id',
			providerErrorHint: 'continuation-reference',
			providerRequestId: jobId
		});
		expect(JSON.stringify(d.events)).not.toMatch(/test-secret|private telemetry|authorization/);
	});
	it.each([
		'not JSON test-secret',
		JSON.stringify({
			error: {
				code: 'test-secret',
				type: 'test-secret',
				param: 'test-secret',
				message: 'private telemetry test-secret'
			}
		}),
		JSON.stringify({ error: { code: 'invalid_value', message: 'test-secret'.repeat(2000) } })
	])('omits malformed, unknown, or oversized provider details', async (body) => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		await diagnosticTransport(
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(
					new Response(body, { status: 400, headers: { 'x-request-id': 'test-secret' } })
				),
			d
		)('https://example.invalid');
		expect(d.events.at(-1)).toMatchObject({ status: 400 });
		expect(d.events.at(-1)?.providerErrorCode).toBeUndefined();
		expect(JSON.stringify(d.events)).not.toMatch(/test-secret|private telemetry/);
	});
	it('bounds a stalled provider body without delaying investigation indefinitely', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const response = new Response(new ReadableStream({ start() {} }), { status: 400 });
		const start = performance.now();
		const returned = await diagnosticTransport(
			vi.fn<typeof fetch>().mockResolvedValue(response),
			d
		)('https://example.invalid');
		expect(returned.status).toBe(400);
		expect(performance.now() - start).toBeLessThan(1500);
		void returned.body?.cancel();
	});
	it('records safe continuation metadata and filters unrecognized submitted tool names', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const model = new MetaResponsesModel({
			apiKey: 'test-secret',
			diagnostics: d,
			transport: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 }))
		});
		await expect(
			model.next(
				{
					goal: 'private telemetry',
					instructions: 'test-secret',
					tools: [],
					trace: [],
					remainingCalls: 2
				},
				new AbortController().signal
			)
		).rejects.toThrow('HTTP 400');
		expect(d.events.find((e) => e.event === 'model-request')).toMatchObject({
			continuation: false,
			payloadBytes: expect.any(Number)
		});
		d.event('model-request', { continuation: true, tool: 'fit_ve_candidate', payloadBytes: 120 });
		d.event('model-request', {
			tool: 'test-secret',
			providerErrorCode: 'test-secret',
			providerRequestId: 'test-secret'
		});
		expect(d.events.at(-2)).toMatchObject({ continuation: true, tool: 'fit_ve_candidate' });
		expect(JSON.stringify(d.events)).not.toMatch(/test-secret|private telemetry/);
	});
	it('allowlists metadata, caps events, and retains the exact final category without private content', () => {
		let now = 1000;
		const d = new InvestigationDiagnostics({
			persist: false,
			now: () => now,
			observe: () => {
				throw new Error('observer failed');
			}
		});
		d.bind(jobId);
		d.start(jobId, 120000);
		d.turn(4);
		for (let i = 0; i < 200; i++)
			d.event('http-end', {
				status: 503,
				elapsedMs: 10,
				category: 'provider-http',
				...({
					headers: { Authorization: 'test-secret' },
					body: 'private telemetry',
					tool: 'private-channel-name',
					outcome: 'test-secret'
				} as object)
			});
		now += 120000;
		d.finish({ code: 'deadline', phase: 'model', modelTurn: 4, tool: null }, 'timeout');
		expect(d.events).toHaveLength(160);
		expect(d.events.at(-1)).toMatchObject({
			event: 'job-end',
			category: 'deadline',
			remainingMs: 0,
			modelTurn: 4,
			runnerStatus: 'timeout'
		});
		const encoded = JSON.stringify(d.events);
		expect(encoded).not.toContain('test-secret');
		expect(encoded).not.toContain('private telemetry');
		expect(encoded).not.toContain('private-channel-name');
	});
	it('persists bounded metadata per job, prunes old records, and cannot fail a run on a storage error', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'agenticefi-diagnostics-'));
		if (!directory.startsWith(join(tmpdir(), 'agenticefi-diagnostics-')))
			throw new Error('Unexpected temporary test directory.');
		try {
			for (let i = 0; i < 34; i++) {
				const d = new InvestigationDiagnostics({ directory });
				d.bind(`${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
				d.finish({ code: 'completed', phase: 'finished', modelTurn: 1, tool: null }, 'completed');
				await d.flush();
			}
			const files = await readdir(directory);
			expect(files).toHaveLength(32);
			const record = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
			expect(record.events.at(-1).event).toBe('job-end');
			const blocked = new InvestigationDiagnostics({
				directory: join(directory, files[0], 'not-a-directory')
			});
			blocked.bind(jobId);
			await expect(blocked.flush()).resolves.toBeUndefined();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it('observes real HTTP attempt boundaries and retries without inspecting request bodies', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		d.start(jobId, 120000);
		d.turn(2);
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(new Response('{}', { status: 200 }));
		const fetch = retryingTransport(diagnosticTransport(transport, d), {
			maxRetries: 2,
			wait: async () => {},
			onDecision: (e) =>
				d.event('retry', { ...e, retryCount: e.decision === 'retry' ? e.attempt : e.attempt - 1 })
		});
		await fetch('https://example.invalid', {
			body: 'private telemetry',
			headers: { Authorization: 'test-secret' },
			method: 'POST'
		});
		expect(transport).toHaveBeenCalledTimes(2);
		expect(
			d.events.filter((e) => e.event === 'http-end').map((e) => [e.modelTurn, e.attempt, e.status])
		).toEqual([
			[2, 1, 503],
			[2, 2, 200]
		]);
		expect(d.events.find((e) => e.event === 'retry')).toMatchObject({
			decision: 'retry',
			retryCount: 1,
			status: 503
		});
		expect(JSON.stringify(d.events)).not.toContain('test-secret');
		expect(JSON.stringify(d.events)).not.toContain('private telemetry');
	});
	it('does not retry ambiguous network failures or restart an investigation', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('test-secret'));
		const fetch = retryingTransport(diagnosticTransport(transport, d), { maxRetries: 2 });
		await expect(fetch('https://example.invalid')).rejects.toThrow();
		expect(transport).toHaveBeenCalledTimes(1);
		expect(d.events.at(-1)).toMatchObject({ category: 'provider-network', outcome: 'failed' });
		expect(JSON.stringify(d.events)).not.toContain('test-secret');
	});
});

describe('termination provenance and partial evidence', () => {
	it('makes the deadline primary when a provider abort also reports cancellation', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const result = await runInvestigation(
			makeRun(),
			{
				next: async (_, signal) =>
					new Promise((_, reject) =>
						signal.addEventListener('abort', () =>
							reject(new InvestigationFailure('cancelled', 'network or cancellation'))
						)
					)
			},
			{ goal: 'inspect', timeoutMs: 20, diagnostics: d }
		);
		expect(result.status).toBe('timeout');
		expect(result.termination).toMatchObject({ code: 'deadline', phase: 'model', modelTurn: 1 });
		expect(result.reason).toContain('deadline exceeded');
		expect(result.reason).not.toContain('network');
		expect(d.events.find((e) => e.event === 'runner-end')).toMatchObject({
			category: 'deadline',
			runnerStatus: 'timeout'
		});
	});
	it.each([503, 429, 401])(
		'retains provider HTTP %s and successful preceding tool evidence',
		async (status) => {
			const result = await runInvestigation(
				makeRun(),
				{
					next: async ({ trace }) => {
						if (!trace.length) return { kind: 'tool', name: 'describe_log', arguments: {} };
						throw new InvestigationFailure(
							'provider-http',
							`Meta API returned HTTP ${status}.`,
							status
						);
					}
				},
				{ goal: 'inspect', timeoutMs: 5000 }
			);
			expect(result.termination).toMatchObject({
				code: 'provider-http',
				providerStatus: status,
				modelTurn: 2
			});
			expect(result.trace).toHaveLength(1);
			expect(result.trace[0].result.ok).toBe(true);
		}
	);
	it('retains the fitted presentation after a later deadline destroys the worker', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let ready!: () => void;
		const awaitingModel = new Promise<void>((resolve) => (ready = resolve));
		const run = makeRun();
		const pending = runInvestigation(
			run,
			{
				next: async ({ trace }) => {
					if (!trace.length) return { kind: 'tool', name: 'fit_ve_candidate', arguments: {} };
					ready();
					return new Promise(() => {});
				}
			},
			{ goal: 'inspect', timeoutMs: 5000 }
		);
		await awaitingModel;
		const before = run.presentationCheckpoint;
		expect(before?.cells).toHaveLength(256);
		await vi.advanceTimersByTimeAsync(5001);
		const result = await pending;
		expect(result.status).toBe('timeout');
		expect(result.trace[0].result.ok).toBe(true);
		expect(run.presentationCheckpoint).toEqual(before);
		expect(run.manifest.evidenceRefs).toHaveLength(0);
	});
	it('logs a selected but interrupted tool separately from successful completed tools', async () => {
		const d = new InvestigationDiagnostics({ persist: false });
		d.bind(jobId);
		const run = makeRun(d);
		vi.spyOn(AnalyticalRun.prototype, 'executeTool').mockImplementation(
			async (_, __, ___, signal) =>
				new Promise((resolve) =>
					signal!.addEventListener('abort', () =>
						resolve({ ok: false, error: 'Analytical request cancelled.' })
					)
				)
		);
		const result = await runInvestigation(
			run,
			{
				next: async () => ({
					kind: 'tool',
					name: 'evaluate_ve_candidate',
					arguments: { candidateRef: 'example' }
				})
			},
			{ goal: 'inspect', timeoutMs: 20, diagnostics: d }
		);
		expect(result.termination).toMatchObject({
			code: 'deadline',
			phase: 'tool',
			tool: 'evaluate_ve_candidate'
		});
		expect(d.events.find((e) => e.event === 'tool-end')).toMatchObject({
			tool: 'evaluate_ve_candidate',
			outcome: 'interrupted',
			category: 'deadline'
		});
		expect(result.trace[0].result.ok).toBe(false);
	});
	it('distinguishes valid early model completion, invalid reports and provider incomplete responses', async () => {
		const early: InvestigationModel = {
			next: async ({ trace }) =>
				!trace.length
					? { kind: 'tool', name: 'describe_log', arguments: {} }
					: { kind: 'final', factIds: [], commentary: [] }
		};
		const result = await runInvestigation(makeRun(), early, { goal: 'inspect', timeoutMs: 5000 });
		expect(result.status).toBe('completed');
		expect(result.termination?.code).toBe('incomplete-workflow');
		expect(result.trace).toHaveLength(1);
		const invalid = await runInvestigation(
			makeRun(),
			{ next: async () => ({ kind: 'final', factIds: ['invented'], commentary: [] }) },
			{ goal: 'inspect', timeoutMs: 5000 }
		);
		expect(invalid.termination?.code).toBe('invalid-report');
		const model = new MetaResponsesModel({
			apiKey: 'test-secret',
			transport: async () =>
				new Response(
					JSON.stringify({
						status: 'incomplete',
						incomplete_details: { reason: 'max_output_tokens' }
					}),
					{ status: 200 }
				)
		});
		const incomplete = await runInvestigation(makeRun(), model, {
			goal: 'inspect',
			timeoutMs: 5000
		});
		expect(incomplete.termination?.code).toBe('provider-incomplete');
		expect(incomplete.reason).not.toContain('test-secret');
	});
	it('shows explicit UI status while retaining legacy fallbacks', () => {
		const job = {
			state: 'finished',
			outcome: 'failed',
			error: 'deadline exceeded',
			result: { status: 'timeout' }
		} as InvestigationJob;
		expect(investigationStatus(job)).toContain('Deadline exceeded');
		expect(
			investigationStatus({
				...job,
				termination: { code: 'incomplete-workflow', phase: 'report', modelTurn: 4, tool: null },
				result: { ...job.result!, status: 'completed' }
			})
		).toContain('Incomplete model workflow');
		expect(investigationStatus({ ...job, result: null })).toBe('Failed / partial');
	});
});
