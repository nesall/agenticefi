import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticalRun } from '../../src/lib/server/investigation/analyticalRun';
import { MetaResponsesModel } from '../../src/lib/server/investigation/metaResponsesModel';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import { InvestigationDiagnostics } from '../../src/lib/server/investigation/diagnostics';
import {
	assessAnalyticalWorkflow,
	type AnalyticalFeedback
} from '../../src/lib/server/investigation/analyticalRecovery';
import { context, veXml, afrXml, scripted, tool, final } from './helpers';
import type { InvestigationModel } from '../../src/lib/shared/types/investigation';

const runs: AnalyticalRun[] = [];
function run(missingAfr = false) {
	const state = new AnalyticalRun({
		contextId: 'recovery-fixture',
		logName: 'synthetic.msl',
		calibrationId: 'confirmed',
		calibrationSemantics: 'rpm-map-kpa-afr',
		veXml,
		...(missingAfr ? {} : { afrXml }),
		logContent: 'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1000\t50\t14\n1\t1000\t50\t14'
	});
	runs.push(state);
	return state;
}
afterEach(async () => {
	vi.useRealTimers();
	await Promise.all(runs.splice(0).map((r) => r.dispose()));
});
const partial = {
	kind: 'final',
	factIds: [],
	commentary: [
		{ kind: 'limitation', text: 'Original validated partial report.', evidenceIds: ['evidence-1'] }
	]
};
function response(id: number, item: unknown) {
	return new Response(
		JSON.stringify({
			id: `resp-${id}`,
			status: 'completed',
			error: null,
			incomplete_details: null,
			output: [item]
		}),
		{ status: 200 }
	);
}
const message = (report: unknown = partial) => ({
	type: 'message',
	role: 'assistant',
	content: [{ type: 'output_text', text: JSON.stringify(report) }]
});
const call = (id: number, name: string, args: unknown = {}) => ({
	type: 'function_call',
	status: 'completed',
	call_id: `call-${id}`,
	name,
	arguments: JSON.stringify(args)
});
type RequestBody = {
	previous_response_id?: string;
	input: string | Record<string, unknown>[];
	tools: { name: string }[];
};
type Behavior =
	| 'success'
	| 'unavailable'
	| 'http-error'
	| 'invalid-final'
	| 'wrong-candidate'
	| 'refit'
	| 'consume-budget'
	| 'stall';
function model(
	behavior: Behavior = 'success',
	onFeedback?: () => void,
	beforeEarlyFinal?: () => Promise<void>
) {
	const bodies: RequestBody[] = [],
		signals: AbortSignal[] = [];
	let candidateRef = '',
		feedback: AnalyticalFeedback | undefined;
	const transport = vi.fn<typeof fetch>(async (_, init) => {
		const body = JSON.parse(String(init?.body)) as RequestBody;
		bodies.push(body);
		signals.push(init!.signal!);
		const n = bodies.length;
		if (Array.isArray(body.input)) {
			const item = body.input[0];
			if (item.type === 'function_call_output') {
				const output = JSON.parse(String(item.output));
				if (output.data?.candidateRef) candidateRef = output.data.candidateRef;
			} else if (item.role === 'user') {
				feedback = JSON.parse((item.content as { text: string }[])[0].text);
				onFeedback?.();
			}
		}
		if (n === 1) return response(n, call(n, 'analyze_afr_error'));
		if (n === 2) return response(n, call(n, 'fit_ve_candidate'));
		if (n === 3) {
			await beforeEarlyFinal?.();
			return response(n, message());
		}
		if (n === 4) {
			if (behavior === 'http-error') return new Response('private provider body', { status: 503 });
			if (behavior === 'stall')
				return new Promise((_, reject) =>
					init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))
				);
			if (behavior === 'unavailable')
				return response(
					n,
					message({
						kind: 'final',
						factIds: [],
						commentary: [
							{
								kind: 'limitation',
								text: 'I claim evaluation is unavailable.',
								evidenceIds: ['evidence-2']
							}
						]
					})
				);
			if (behavior === 'invalid-final')
				return response(n, message({ kind: 'final', factIds: ['invented'], commentary: [] }));
			if (behavior === 'wrong-candidate')
				return response(
					n,
					call(n, 'evaluate_ve_candidate', { candidateRef: 'another-run:candidate' })
				);
			if (behavior === 'refit') return response(n, call(n, 'fit_ve_candidate'));
			if (behavior === 'consume-budget') return response(n, call(n, 'describe_log'));
			return response(n, call(n, 'evaluate_ve_candidate', { candidateRef }));
		}
		if (n === 5 && ['wrong-candidate', 'refit'].includes(behavior))
			return response(n, call(n, 'evaluate_ve_candidate', { candidateRef }));
		if (behavior === 'consume-budget') return response(n, call(n, 'describe_log'));
		return response(
			n,
			message({
				kind: 'final',
				factIds: [],
				commentary: [
					{
						kind: 'interpretation',
						text: 'Recovered report backed by completed evaluation.',
						evidenceIds: [`evidence-${n - 2}`]
					}
				]
			})
		);
	});
	return {
		adapter: new MetaResponsesModel({ apiKey: 'test-secret', transport }),
		bodies,
		signals,
		transport,
		get feedback() {
			return feedback;
		},
		get candidateRef() {
			return candidateRef;
		}
	};
}
const diagnostics = () => {
	const d = new InvestigationDiagnostics({ persist: false });
	d.bind('11111111-1111-4111-8111-111111111111');
	return d;
};

describe('single bounded analytical final-report recovery (mock HTTP, actual deterministic tools)', () => {
	it('continues from the early final response without replaying completed calls and evaluates the frozen candidate', async () => {
		const state = run(),
			m = model(),
			d = diagnostics(),
			settings = JSON.stringify(state.settings);
		const result = await runInvestigation(state, m.adapter, {
			goal: 'inspect',
			maxIterations: 7,
			maxToolCalls: 6,
			timeoutMs: 5000,
			diagnostics: d
		});
		expect(result.termination?.code).toBe('completed');
		expect(result.status).toBe('completed');
		expect(result.trace.map((t) => t.tool)).toEqual([
			'analyze_afr_error',
			'fit_ve_candidate',
			'evaluate_ve_candidate'
		]);
		expect(m.bodies).toHaveLength(5);
		expect(m.bodies[3].previous_response_id).toBe('resp-3');
		expect(m.bodies[3].input).toEqual([
			{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(m.feedback) }] }
		]);
		expect(m.feedback).toMatchObject({
			type: 'analytical_workflow_incomplete',
			recoveryOpportunity: 1,
			missingStages: ['evaluate_ve_candidate'],
			finalizedCandidateRef: m.candidateRef
		});
		expect(m.bodies[3].tools.some((t) => t.name === 'fit_ve_candidate')).toBe(false);
		expect(m.bodies[4].previous_response_id).toBe('resp-4');
		expect((m.bodies[4].input as Record<string, unknown>[])[0]).toMatchObject({
			type: 'function_call_output',
			call_id: 'call-4'
		});
		expect(m.signals.every((s) => s === m.signals[0])).toBe(true);
		expect(JSON.stringify(state.settings)).toBe(settings);
		expect(state.manifest.evidenceRefs.filter((r) => r.kind === 'candidate')).toHaveLength(1);
		expect(assessAnalyticalWorkflow(state, result.trace).complete).toBe(true);
		expect(d.events.filter((e) => e.event === 'recovery-offered')).toHaveLength(1);
		expect(d.events.find((e) => e.event === 'recovery-end')).toMatchObject({
			decision: 'completed'
		});
		await expect(
			m.adapter.continueAnalyticalFinal(
				{
					goal: 'inspect',
					instructions: 'inspect',
					tools: [],
					trace: result.trace,
					remainingCalls: 1,
					reportMode: 'analytical'
				},
				m.feedback!,
				new AbortController().signal
			)
		).rejects.toThrow('continuation is unavailable');
		expect(m.bodies).toHaveLength(5);
	});
	it.each(['unavailable', 'http-error', 'invalid-final'] as const)(
		'retains the original partial report when recovery returns %s',
		async (behavior) => {
			const state = run(),
				m = model(behavior),
				d = diagnostics();
			const result = await runInvestigation(state, m.adapter, {
				goal: 'inspect',
				timeoutMs: 5000,
				diagnostics: d
			});
			expect(result.report?.commentary).toEqual([
				{ ...partial.commentary[0], verification: 'unverified-model-commentary' }
			]);
			expect(result.trace).toHaveLength(2);
			expect(m.bodies).toHaveLength(4);
			expect(result.termination?.code).toBe(
				behavior === 'unavailable'
					? 'incomplete-workflow'
					: behavior === 'http-error'
						? 'provider-http'
						: 'invalid-report'
			);
			expect(d.events.find((e) => e.event === 'recovery-end')).toBeDefined();
			expect(JSON.stringify(d.events)).not.toContain('private provider body');
		}
	);
	it.each(['wrong-candidate', 'refit'] as const)(
		'rejects %s locally without fitting or changing the candidate',
		async (behavior) => {
			const state = run(),
				m = model(behavior),
				d = diagnostics();
			const result = await runInvestigation(state, m.adapter, {
				goal: 'inspect',
				maxIterations: 7,
				maxToolCalls: 6,
				timeoutMs: 5000,
				diagnostics: d
			});
			expect(result.termination?.code).toBe('completed');
			expect(result.trace[2].result.ok).toBe(false);
			expect(result.trace[3].result.ok).toBe(true);
			expect(state.manifest.timings.filter((t) => t.tool === 'fit_ve_candidate')).toHaveLength(1);
			expect(state.manifest.evidenceRefs.filter((r) => r.kind === 'candidate')).toHaveLength(1);
			expect(d.events.some((e) => e.event === 'recovery-guard')).toBe(true);
		}
	);
	it('does not initiate fitting or recovery for an early final with no candidate', async () => {
		const state = run(),
			continueAnalyticalFinal = vi.fn(),
			d = diagnostics();
		const m = { ...scripted(tool('describe_log'), partial), continueAnalyticalFinal };
		const result = await runInvestigation(state, m, {
			goal: 'inspect',
			timeoutMs: 5000,
			diagnostics: d
		});
		expect(result.termination?.code).toBe('incomplete-workflow');
		expect(continueAnalyticalFinal).not.toHaveBeenCalled();
		expect(state.manifest.evidenceRefs.some((r) => r.kind === 'candidate')).toBe(false);
		expect(d.events.find((e) => e.event === 'recovery-skipped')).toMatchObject({
			decision: 'no-candidate'
		});
	});
	it('accepts unavailable analysis only when the private server evidence verifies the blocker', async () => {
		const state = run(true),
			continueAnalyticalFinal = vi.fn();
		const calibrationModel = {
			...scripted(tool('fit_ve_candidate'), partial),
			continueAnalyticalFinal
		};
		const result = await runInvestigation(state, calibrationModel, {
			goal: 'inspect',
			timeoutMs: 5000
		});
		expect(result.termination?.code).toBe('completed');
		expect(result.reason).toContain('server-verified');
		expect(assessAnalyticalWorkflow(state, result.trace).verifiedBlocker).toBe(true);
		expect(continueAnalyticalFinal).not.toHaveBeenCalled();
	});
	it('keeps the original deadline and report if feedback continuation stalls', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let ready!: () => void;
		const feedbackRequested = new Promise<void>((r) => (ready = r));
		const state = run(),
			m = model('stall', ready, async () => {
				await vi.advanceTimersByTimeAsync(4000);
			}),
			d = diagnostics();
		const pending = runInvestigation(state, m.adapter, {
			goal: 'inspect',
			timeoutMs: 5000,
			diagnostics: d
		});
		await feedbackRequested;
		await vi.advanceTimersByTimeAsync(1001);
		const result = await pending;
		expect(result.termination?.code).toBe('deadline');
		expect(m.bodies).toHaveLength(4);
		expect(result.report?.commentary?.[0].text).toBe(partial.commentary[0].text);
		expect(d.events.find((e) => e.event === 'recovery-end')).toMatchObject({
			category: 'deadline',
			decision: 'failed'
		});
	});
	it.each([
		{ maxIterations: 3, maxToolCalls: 6, decision: 'no-turn-budget' },
		{ maxIterations: 4, maxToolCalls: 6, decision: 'no-turn-budget' },
		{ maxIterations: 7, maxToolCalls: 2, decision: 'no-tool-budget' }
	])('skips recovery when existing budgets cannot complete it: %j', async (options) => {
		const state = run(),
			m = model(),
			d = diagnostics();
		const result = await runInvestigation(state, m.adapter, {
			goal: 'inspect',
			timeoutMs: 5000,
			maxIterations: options.maxIterations,
			maxToolCalls: options.maxToolCalls,
			diagnostics: d
		});
		expect(result.termination?.code).toBe('incomplete-workflow');
		expect(m.bodies).toHaveLength(3);
		expect(result.report?.commentary?.[0].text).toBe(partial.commentary[0].text);
		expect(d.events.find((e) => e.event === 'recovery-skipped')).toMatchObject({
			decision: options.decision
		});
	});
	it.each([
		{ maxIterations: 5, maxToolCalls: 4, rows: 4 },
		{ maxIterations: 7, maxToolCalls: 3, rows: 3 }
	])(
		'stops at the original call/turn limits even when the model spends its recovery inspecting: %j',
		async (options) => {
			const state = run(),
				m = model('consume-budget');
			const result = await runInvestigation(state, m.adapter, {
				goal: 'inspect',
				timeoutMs: 5000,
				maxIterations: options.maxIterations,
				maxToolCalls: options.maxToolCalls
			});
			expect(result.status).toBe('limit_reached');
			expect(m.bodies).toHaveLength(5);
			expect(result.trace).toHaveLength(options.rows);
			expect(result.report?.commentary?.[0].text).toBe(partial.commentary[0].text);
		}
	);
	it('does not continue a legacy final or accept a modified trace for analytical continuation', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(1, message(final())));
		const m = new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch });
		const legacyInput: Parameters<InvestigationModel['next']>[0] = {
			goal: 'inspect',
			instructions: 'inspect',
			tools: [],
			trace: [],
			remainingCalls: 4
		};
		await m.next(legacyInput, new AbortController().signal);
		const feedback: AnalyticalFeedback = {
			type: 'analytical_workflow_incomplete',
			recoveryOpportunity: 1,
			missingStages: ['evaluate_ve_candidate'],
			finalizedCandidateRef: 'test:candidate',
			message: 'test'
		};
		await expect(
			m.continueAnalyticalFinal(
				{ ...legacyInput, reportMode: 'analytical' },
				feedback,
				new AbortController().signal
			)
		).rejects.toThrow('continuation is unavailable');
		expect(fetch).toHaveBeenCalledTimes(1);
		const analyticFetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(response(1, message()));
		const analytic = new MetaResponsesModel({ apiKey: 'test-secret', transport: analyticFetch });
		await analytic.next({ ...legacyInput, reportMode: 'analytical' }, new AbortController().signal);
		await expect(
			analytic.continueAnalyticalFinal(
				{
					...legacyInput,
					reportMode: 'analytical',
					trace: [
						{
							evidenceId: 'evidence-1',
							tool: 'describe_log',
							arguments: {},
							result: { ok: true, data: {} }
						}
					]
				},
				feedback,
				new AbortController().signal
			)
		).rejects.toThrow('trace changed');
		expect(analyticFetch).toHaveBeenCalledTimes(1);
		const result = await runInvestigation(context(), scripted(tool('describe_log'), final()), {
			goal: 'inspect'
		});
		expect(result.status).toBe('completed');
		expect(result.termination).toBeUndefined();
	});
});
