import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	retryAfterMs,
	retryingTransport,
	safeResponseHeaders,
	type RetryEvent
} from './live/analyticalSmokeTransport';
import { MetaResponsesModel } from '../src/lib/server/investigation/metaResponsesModel';
import { analyticalTools } from '../src/lib/server/investigation/analyticalProtocol';

afterEach(() => vi.useRealTimers());
const endpoint = 'https://api.meta.ai/v1/responses';
const request = { method: 'POST', body: '{"model":"test"}' };

describe('smoke-only bounded resilience (mock transport; no live requests)', () => {
	it('leaves no-retry mode at exactly one request', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response(null, { status: 503 }));
		const decisions: RetryEvent[] = [];
		const result = await retryingTransport(fetch, {
			maxRetries: 0,
			onDecision: (d) => decisions.push(d)
		})(endpoint, request);
		expect(result.status).toBe(503);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(decisions[0].decision).toBe('disabled');
	});
	it.each([429, 500, 502, 503, 504])(
		'recovers HTTP %s while replaying identical JSON and signal',
		async (status) => {
			const response = new Response('{}');
			const fetch = vi
				.fn<typeof globalThis.fetch>()
				.mockResolvedValueOnce(new Response(null, { status }))
				.mockResolvedValue(response);
			const wait = vi.fn().mockResolvedValue(undefined);
			const signal = new AbortController().signal;
			expect(
				await retryingTransport(fetch, { maxRetries: 2, wait, random: () => 1 })(endpoint, {
					...request,
					signal
				})
			).toBe(response);
			expect(fetch).toHaveBeenCalledTimes(2);
			expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
			expect(wait).toHaveBeenCalledWith(500, signal);
		}
	);
	it('exhausts after two retries, reports attempts and increases bounded backoff', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => new Response(null, { status: 503 }));
		const wait = vi.fn().mockResolvedValue(undefined);
		const decisions: RetryEvent[] = [];
		const result = await retryingTransport(fetch, {
			maxRetries: 2,
			wait,
			random: () => 0,
			onDecision: (d) => decisions.push(d)
		})(endpoint, request);
		expect(result.status).toBe(503);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(wait.mock.calls.map((c) => c[0])).toEqual([250, 500]);
		expect(decisions.map((d) => d.decision)).toEqual(['retry', 'retry', 'exhausted']);
	});
	it.each([400, 401, 403, 404, 422, 501])('does not retry HTTP %s', async (status) => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response(null, { status }));
		await retryingTransport(fetch, { maxRetries: 2 })(endpoint, request);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('does not retry ambiguous network errors or successful protocol-invalid responses', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockRejectedValue(new Error('mock network failure'));
		await expect(retryingTransport(fetch, { maxRetries: 2 })(endpoint, request)).rejects.toThrow(
			'mock network failure'
		);
		expect(fetch).toHaveBeenCalledTimes(1);
		fetch.mockReset().mockResolvedValue(new Response('not JSON'));
		const response = await retryingTransport(fetch, { maxRetries: 2 })(endpoint, request);
		expect(await response.text()).toBe('not JSON');
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('honors Retry-After without shortening it; declines delays above the ten-second cap', async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '3' } }))
			.mockResolvedValue(new Response('{}'));
		const wait = vi.fn().mockResolvedValue(undefined);
		await retryingTransport(fetch, { maxRetries: 2, wait })(endpoint, request);
		expect(wait.mock.calls[0][0]).toBe(3000);
		fetch
			.mockReset()
			.mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '11' } }));
		const decisions: RetryEvent[] = [];
		await retryingTransport(fetch, { maxRetries: 2, wait, onDecision: (d) => decisions.push(d) })(
			endpoint,
			request
		);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(decisions[0].decision).toBe('retry-after-exceeds-cap');
	});
	it('preserves cancellation across backoff and sends no later request', async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response(null, { status: 503 }));
		const pending = retryingTransport(fetch, { maxRetries: 2 })(endpoint, {
			...request,
			signal: controller.signal
		});
		const assertion = expect(pending).rejects.toThrow();
		await vi.advanceTimersByTimeAsync(1);
		controller.abort();
		await assertion;
		await vi.runAllTimersAsync();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('does not send a request after the deadline signal is already aborted', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		await expect(
			retryingTransport(fetch, { maxRetries: 2 })(endpoint, {
				...request,
				signal: AbortSignal.abort()
			})
		).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
	it('parses seconds/HTTP dates and records only allowlisted, bounded response headers', () => {
		const now = Date.parse('Wed, 28 Oct 2026 09:00:00 GMT');
		expect(retryAfterMs('Wed, 28 Oct 2026 09:00:04 GMT', now)).toBe(4000);
		expect(retryAfterMs('Wed, 28 Oct 2026 08:00:00 GMT', now)).toBe(0);
		expect(retryAfterMs('3')).toBe(3000);
		for (const bad of ['-1', '3.5', 'not a date']) expect(retryAfterMs(bad)).toBeNull();
		expect(retryAfterMs('99999999999999999999999')).toBe(Number.POSITIVE_INFINITY);
		expect(
			safeResponseHeaders(
				new Headers({
					'x-request-id': 'req-123',
					'x-fb-trace-id': 'trace_4',
					'retry-after': '2',
					authorization: 'secret',
					'set-cookie': 'secret',
					'x-fb-request-id': 'invalid value'
				})
			)
		).toEqual({
			requestIds: { 'x-request-id': 'req-123', 'x-fb-trace-id': 'trace_4' },
			retryAfter: '2'
		});
	});
	it.each([-1, 3, 1.5])('rejects excessive or invalid retry configuration %s', (maxRetries) => {
		expect(() => retryingTransport(vi.fn(), { maxRetries })).toThrow();
	});
	it('recovers inside the existing adapter without changing continuation or repeating tool execution', async () => {
		const response = (output: unknown[], id: string) =>
			new Response(JSON.stringify({ id, status: 'completed', output }));
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(
				response(
					[{ type: 'function_call', call_id: 'call-1', name: 'fit_ve_candidate', arguments: '{}' }],
					'resp-1'
				)
			)
			.mockResolvedValueOnce(
				response(
					[
						{
							type: 'message',
							role: 'assistant',
							content: [
								{ type: 'output_text', text: '{"kind":"final","factIds":[],"commentary":[]}' }
							]
						}
					],
					'resp-2'
				)
			);
		const model = new MetaResponsesModel({
			apiKey: 'mock-secret',
			transport: retryingTransport(fetch, { maxRetries: 2, wait: async () => {} })
		});
		const input = {
			goal: 'offline protocol test',
			instructions: '',
			tools: analyticalTools,
			trace: [],
			remainingCalls: 6,
			reportMode: 'analytical' as const
		};
		expect(await model.next(input, new AbortController().signal)).toEqual({
			kind: 'tool',
			name: 'fit_ve_candidate',
			arguments: {}
		});
		expect(
			await model.next(
				{
					...input,
					trace: [
						{
							evidenceId: 'evidence-1',
							tool: 'fit_ve_candidate',
							arguments: {},
							result: { ok: true, data: {} }
						}
					]
				},
				new AbortController().signal
			)
		).toEqual({ kind: 'final', factIds: [], commentary: [] });
		expect(fetch.mock.calls[0][1]!.body).toBe(fetch.mock.calls[1][1]!.body);
		expect(JSON.parse(String(fetch.mock.calls[2][1]!.body))).toMatchObject({
			previous_response_id: 'resp-1',
			input: [{ call_id: 'call-1', type: 'function_call_output' }]
		});
		expect(model.lastError).toBeNull();
	});
});
