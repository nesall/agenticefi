import { describe, expect, it } from 'vitest';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import { context, final, scripted, tool } from './helpers';

const goal = 'Investigate whether data quality permits further analysis.';
describe('bounded investigation runner', () => {
	it('dispatches tools, passes their results to the model, and validates citations', async () => {
		const script = scripted(
			tool('describe_log'),
			tool('assess_data_quality'),
			final(['evidence-1', 'evidence-2'])
		);
		const result = await runInvestigation(context(), script, { goal });
		expect(result.status).toBe('completed');
		expect(result.trace.map((entry) => entry.evidenceId)).toEqual(['evidence-1', 'evidence-2']);
		expect(result.report!.limitations.join(' ')).toContain('skip malformed rows');
	});
	it('allows recovery after invalid tool arguments without treating errors as evidence', async () => {
		const result = await runInvestigation(
			context(),
			scripted(tool('unknown'), tool('describe_log'), final(['evidence-2'])),
			{ goal }
		);
		expect(result.status).toBe('completed');
		expect(result.trace[0].result.ok).toBe(false);
	});
	it.each(['evidence-99', 'evidence-1'])(
		'rejects nonexistent or failed-tool citation %s',
		async (id) => {
			const result = await runInvestigation(
				context(),
				scripted(tool('unknown'), tool('describe_log'), final([id])),
				{ goal }
			);
			expect(result.status).toBe('invalid_response');
			expect(result.report).toBeNull();
		}
	);
	it('accepts an explicit insufficient-evidence report after inspecting a tool result', async () => {
		const result = await runInvestigation(
			context(),
			scripted(tool('describe_log'), {
				kind: 'final',
				findings: [],
				limitations: ['No eligibility tool is available.']
			}),
			{ goal }
		);
		expect(result.status).toBe('completed');
		expect(result.report!.findings).toEqual([]);
	});
	it('rejects a report produced without tool evidence', async () => {
		expect((await runInvestigation(context(), scripted(final()), { goal })).status).toBe(
			'invalid_response'
		);
	});
	it('enforces tool limits but allows a final answer after the last permitted call', async () => {
		expect(
			(
				await runInvestigation(context(), scripted(tool('describe_log'), tool('describe_log')), {
					goal,
					maxToolCalls: 1
				})
			).status
		).toBe('limit_reached');
		expect(
			(
				await runInvestigation(context(), scripted(tool('describe_log'), final()), {
					goal,
					maxToolCalls: 1
				})
			).status
		).toBe('completed');
	});
	it('enforces the iteration limit', async () => {
		const result = await runInvestigation(
			context(),
			scripted(tool('describe_log'), tool('describe_log')),
			{ goal, maxIterations: 2 }
		);
		expect(result.status).toBe('limit_reached');
		expect(result.trace).toHaveLength(2);
	});
	it('handles model failures', async () => {
		expect(
			(
				await runInvestigation(
					context(),
					{
						async next() {
							throw new Error('secret');
						}
					},
					{ goal }
				)
			).status
		).toBe('model_error');
	});
	it('times out even when the model ignores the abort signal', async () => {
		expect(
			(
				await runInvestigation(
					context(),
					{ next: () => new Promise(() => {}) },
					{ goal, timeoutMs: 10 }
				)
			).status
		).toBe('timeout');
	});
	it('supports cancellation before starting', async () => {
		const controller = new AbortController();
		controller.abort();
		expect(
			(await runInvestigation(context(), scripted(), { goal, signal: controller.signal })).status
		).toBe('cancelled');
	});
	it('supports cancellation while awaiting a model', async () => {
		const controller = new AbortController();
		const pending = runInvestigation(
			context(),
			{
				async next() {
					controller.abort();
					return new Promise(() => {});
				}
			},
			{ goal, signal: controller.signal }
		);
		expect((await pending).status).toBe('cancelled');
	});
	it('honors cancellation even when the model returns at the same time', async () => {
		const controller = new AbortController();
		const result = await runInvestigation(
			context(),
			{
				async next() {
					controller.abort();
					return tool('describe_log');
				}
			},
			{ goal, signal: controller.signal }
		);
		expect(result.status).toBe('cancelled');
		expect(result.trace).toHaveLength(0);
	});
	it.each([
		null,
		{ kind: 'tool', name: 1 },
		{ kind: 'final', findings: [], limitations: [] },
		{ kind: 'tool', name: 'describe_log', arguments: {}, extra: true }
	])('rejects malformed response %#', async (response) => {
		expect((await runInvestigation(context(), scripted(response), { goal })).status).toBe(
			'invalid_response'
		);
	});
	it('rejects oversized output', async () => {
		expect(
			(await runInvestigation(context(), scripted({ text: 'a'.repeat(21000) }), { goal })).status
		).toBe('invalid_response');
	});
	it('gives the model snapshots, preventing mutation of stored evidence', async () => {
		let turn = 0;
		const result = await runInvestigation(
			context(),
			{
				async next(input) {
					if (!turn++) return tool('describe_log');
					input.trace[0].evidenceId = 'forged';
					return final();
				}
			},
			{ goal }
		);
		expect(result.status).toBe('completed');
		expect(result.trace[0].evidenceId).toBe('evidence-1');
	});
	it('rejects invalid limits before running', async () => {
		await expect(
			runInvestigation(context(), scripted(), { goal, maxToolCalls: 0 })
		).rejects.toThrow(RangeError);
	});
});
