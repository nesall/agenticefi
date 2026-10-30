import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MetaResponsesModel,
	META_MODEL
} from '../../src/lib/server/investigation/metaResponsesModel';
import { investigationTools } from '../../src/lib/server/investigation/tools';
import { analyticalTools } from '../../src/lib/server/investigation/analyticalProtocol';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import type { InvestigationModel, ToolTraceEntry } from '../../src/lib/shared/types/investigation';
import { context, final } from './helpers';
import { InvestigationDiagnostics } from '../../src/lib/server/investigation/diagnostics';

const signal = () => new AbortController().signal;
const input = (trace: ToolTraceEntry[] = []): Parameters<InvestigationModel['next']>[0] => ({
	goal: 'Inspect data quality.',
	instructions: 'Use evidence.',
	tools: investigationTools,
	trace,
	remainingCalls: 6 - trace.length
});
const call = (overrides = {}) => ({
	type: 'function_call',
	status: 'completed',
	call_id: 'call-1',
	name: 'describe_log',
	arguments: '{}',
	...overrides
});
const message = (text = JSON.stringify(final())) => ({
	type: 'message',
	role: 'assistant',
	content: [{ type: 'output_text', text }]
});
const response = (output: unknown[], overrides = {}) =>
	new Response(
		JSON.stringify({
			id: 'resp-1',
			status: 'completed',
			error: null,
			incomplete_details: null,
			output,
			...overrides
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
const traceEntry = (): ToolTraceEntry => ({
	evidenceId: 'evidence-1',
	tool: 'describe_log',
	arguments: {},
	result: { ok: true, data: { rowCount: 3 } }
});
const transport = () => vi.fn<typeof fetch>();
afterEach(() => vi.unstubAllEnvs());

describe('Meta Responses protocol adapter', () => {
	it('advertises analytical native tools and the separate fact/commentary report contract', async () => {
		const fetch = transport().mockResolvedValue(response([call({ name: 'fit_ve_candidate' })]));
		const model = new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch });
		expect(
			await model.next({ ...input(), tools: analyticalTools, reportMode: 'analytical' }, signal())
		).toEqual({ kind: 'tool', name: 'fit_ve_candidate', arguments: {} });
		const body = JSON.parse(String(fetch.mock.calls[0][1]!.body));
		expect(body.text).toEqual({ format: { type: 'json_object' } });
		expect(body.response_format).toBeUndefined();
		expect(body.tools.map((t: { name: string }) => t.name)).toEqual(
			analyticalTools.map((t) => t.name)
		);
		expect(body.instructions).toContain('factIds');
		expect(body.instructions).toContain('commentary');
		expect(body.instructions).not.toContain('Call describe_log first');
	});
	it('uses native flat tools, the approved endpoint/model and sequential mode', async () => {
		const fetch = transport().mockResolvedValue(
			response([{ type: 'reasoning', summary: [] }, call()])
		);
		const model = new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch });
		expect(await model.next(input(), signal())).toEqual({
			kind: 'tool',
			name: 'describe_log',
			arguments: {}
		});
		const [url, request] = fetch.mock.calls[0];
		expect(url).toBe('https://api.meta.ai/v1/responses');
		expect(request).toMatchObject({
			method: 'POST',
			redirect: 'error',
			headers: { Authorization: 'Bearer test-secret' }
		});
		const body = JSON.parse(String(request!.body));
		expect(META_MODEL).toBe('muse-spark-1.3');
		expect(body.text).toEqual({ format: { type: 'json_object' } });
		expect(body).toMatchObject({
			model: META_MODEL,
			input: 'Inspect data quality.',
			parallel_tool_calls: false,
			tool_choice: 'auto',
			store: true,
			max_output_tokens: 4096
		});
		expect(body.previous_response_id).toBeUndefined();
		expect(body.tools[0]).toEqual({
			type: 'function',
			name: 'describe_log',
			description: investigationTools[0].description,
			parameters: investigationTools[0].inputSchema
		});
		expect(body.tools[0].function).toBeUndefined();
		expect(JSON.stringify(model)).not.toContain('test-secret');
	});

	it('sends each tool result with its original call ID, evidence ID and previous response ID', async () => {
		const fetch = transport()
			.mockResolvedValueOnce(response([call()]))
			.mockResolvedValueOnce(response([message()], { id: 'resp-2' }));
		const diagnostics = new InvestigationDiagnostics({ persist: false });
		diagnostics.bind('11111111-1111-4111-8111-111111111111');
		const model = new MetaResponsesModel({ apiKey: 'test', transport: fetch, diagnostics });
		await model.next(input(), signal());
		expect(await model.next(input([traceEntry()]), signal())).toEqual(final());
		const body = JSON.parse(String(fetch.mock.calls[1][1]!.body));
		expect(body.text).toEqual({ format: { type: 'json_object' } });
		expect(diagnostics.events.filter((e) => e.event === 'model-request')).toMatchObject([
			{
				continuation: false,
				payloadBytes: Buffer.byteLength(String(fetch.mock.calls[0][1]!.body))
			},
			{
				continuation: true,
				tool: 'describe_log',
				payloadBytes: Buffer.byteLength(String(fetch.mock.calls[1][1]!.body))
			}
		]);
		expect(body.previous_response_id).toBe('resp-1');
		expect(body.input).toEqual([
			{
				type: 'function_call_output',
				call_id: 'call-1',
				output: JSON.stringify({ evidenceId: 'evidence-1', ok: true, data: { rowCount: 3 } })
			}
		]);
		expect(body.instructions).toContain('5 tool calls remaining');
		await expect(model.next(input(), signal())).rejects.toThrow('new MetaResponsesModel');
	});

	it('preserves call IDs across multiple tool turns and forwards tool errors', async () => {
		const fetch = transport()
			.mockResolvedValueOnce(response([call({ name: 'unknown' })]))
			.mockResolvedValueOnce(response([call({ call_id: 'call-2' })], { id: 'resp-2' }))
			.mockResolvedValueOnce(
				response([message(JSON.stringify(final(['evidence-2'])))], { id: 'resp-3' })
			);
		const model = new MetaResponsesModel({ apiKey: 'test', transport: fetch });
		const result = await runInvestigation(context(), model, { goal: 'Investigate.' });
		expect(result.status).toBe('completed');
		const second = JSON.parse(String(fetch.mock.calls[1][1]!.body));
		expect(JSON.parse(second.input[0].output)).toMatchObject({
			evidenceId: 'evidence-1',
			ok: false
		});
		const third = JSON.parse(String(fetch.mock.calls[2][1]!.body));
		expect(third.previous_response_id).toBe('resp-2');
		expect(third.input[0].call_id).toBe('call-2');
	});

	it('reads the key from the server environment without printing it', () => {
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		vi.stubEnv('META_API_KEY', '');
		expect(() => new MetaResponsesModel()).toThrow('META_HACKATHON_API_KEY is not set');
		vi.stubEnv('META_HACKATHON_API_KEY', 'environment-secret');
		expect(JSON.stringify(new MetaResponsesModel())).not.toContain('environment-secret');
	});
	it('uses the alias credential for requests when the project-specific key is absent', async () => {
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		vi.stubEnv('META_API_KEY', 'alias-secret');
		const fetch = transport().mockResolvedValue(response([message()]));
		const model = new MetaResponsesModel({ transport: fetch });
		await model.next(input(), signal());
		expect(fetch.mock.calls[0][1]!.headers).toMatchObject({ Authorization: 'Bearer alias-secret' });
		expect(JSON.stringify(model)).not.toContain('alias-secret');
	});

	it.each([400, 401, 429, 500])(
		'reports HTTP %s without exposing response bodies',
		async (status) => {
			const fetch = transport().mockResolvedValue(new Response('test-secret', { status }));
			const model = new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch });
			await expect(model.next(input(), signal())).rejects.toThrow(`HTTP ${status}`);
			expect(model.lastError).not.toContain('test-secret');
			expect(fetch).toHaveBeenCalledTimes(1);
		}
	);

	it('sanitizes transport failures', async () => {
		const fetch = transport().mockRejectedValue(new Error('test-secret'));
		const model = new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch });
		await expect(model.next(input(), signal())).rejects.toThrow('network or cancellation');
		expect(model.lastError).not.toContain('test-secret');
	});

	it('propagates the runner signal and does not fetch after cancellation', async () => {
		const fetch = transport().mockResolvedValue(response([call()]));
		const model = new MetaResponsesModel({ apiKey: 'test', transport: fetch });
		const s = signal();
		await model.next(input(), s);
		expect(fetch.mock.calls[0][1]!.signal).toBe(s);
		const controller = new AbortController();
		controller.abort();
		await expect(model.next(input([traceEntry()]), controller.signal)).rejects.toThrow('cancelled');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each(
		[
			[],
			[call(), call({ call_id: 'call-2' })],
			[call({ call_id: '' })],
			[call({ call_id: 'a'.repeat(65) })],
			[call({ arguments: 'not-json' })],
			[call({ arguments: 'a'.repeat(16001) })],
			[call({ status: 'in_progress' })],
			[{ type: 'web_search_call' }],
			[message('not-json')],
			[message('```json\n{}\n```')],
			[message('{"kind":"tool","name":"describe_log","arguments":{}}')],
			[message('a'.repeat(21000))]
		].map((output) => ({ output }))
	)('rejects malformed or unsupported output %#', async ({ output }) => {
		const model = new MetaResponsesModel({
			apiKey: 'test',
			transport: transport().mockResolvedValue(response(output))
		});
		await expect(model.next(input(), signal())).rejects.toThrow();
	});

	it.each([
		{ status: 'incomplete' },
		{ status: 'failed' },
		{ error: { message: 'secret' } },
		{ incomplete_details: { reason: 'max_output_tokens' } },
		{ id: '' },
		{ output: null }
	])('rejects invalid response envelopes %#', async (overrides) => {
		const model = new MetaResponsesModel({
			apiKey: 'test',
			transport: transport().mockResolvedValue(response([call()], overrides))
		});
		await expect(model.next(input(), signal())).rejects.toThrow();
		expect(model.lastError).not.toContain('secret');
	});

	it.each([
		['{"kind":"final","private telemetry":"test-secret"', 'invalid-json'],
		['```json\n{"kind":"final","private telemetry":"test-secret"}\n```', 'fenced-json'],
		['["test-secret"]', 'non-object-json'],
		['"test-secret"', 'non-object-json'],
		['null', 'non-object-json'],
		['{"kind":"tool","text":"test-secret"}', 'invalid-report-kind'],
		['', 'empty-report'],
		['test-secret'.repeat(2000), 'oversized-report']
	])('strictly rejects and classifies final text %#: %s', async (text, decision) => {
		const diagnostics = new InvestigationDiagnostics({ persist: false });
		diagnostics.bind('11111111-1111-4111-8111-111111111111');
		const reply = response([message(text)]);
		reply.headers.set('x-request-id', 'req_1234567890abcdef');
		const model = new MetaResponsesModel({
			apiKey: 'test-secret',
			diagnostics,
			transport: transport().mockResolvedValue(reply)
		});
		await expect(model.next(input(), signal())).rejects.toMatchObject({
			code: 'provider-protocol'
		});
		expect(diagnostics.events.at(-1)).toMatchObject({
			event: 'report-parse',
			decision,
			payloadBytes: Buffer.byteLength(text),
			providerRequestId: 'req_1234567890abcdef'
		});
		expect(JSON.stringify(diagnostics.events)).not.toMatch(
			/test-secret|private telemetry|output_text/
		);
		expect(model.lastError).not.toContain('test-secret');
	});

	it.each([
		[{ type: 'refusal', refusal: 'test-secret private telemetry' }, 'refusal'],
		[{ type: 'unexpected', text: 'test-secret private telemetry' }, 'invalid-output']
	])(
		'classifies unusable content without retaining refusal or provider text %#',
		async (part, decision) => {
			const diagnostics = new InvestigationDiagnostics({ persist: false });
			diagnostics.bind('11111111-1111-4111-8111-111111111111');
			const reply = response([{ ...message(), content: [part] }]);
			reply.headers.set('x-request-id', 'test-secret');
			const model = new MetaResponsesModel({
				apiKey: 'test-secret',
				diagnostics,
				transport: transport().mockResolvedValue(reply)
			});
			await expect(model.next(input(), signal())).rejects.toMatchObject({
				code: 'provider-protocol'
			});
			expect(diagnostics.events.at(-1)).toMatchObject({ event: 'report-parse', decision });
			expect(JSON.stringify(diagnostics.events)).not.toMatch(/test-secret|private telemetry/);
		}
	);

	it('rejects explicit token truncation before trying to parse a partial final report', async () => {
		const diagnostics = new InvestigationDiagnostics({ persist: false });
		diagnostics.bind('11111111-1111-4111-8111-111111111111');
		const model = new MetaResponsesModel({
			apiKey: 'test-secret',
			diagnostics,
			transport: transport().mockResolvedValue(
				response([message('{"kind":"final"')], {
					status: 'incomplete',
					incomplete_details: { reason: 'max_output_tokens' }
				})
			)
		});
		await expect(model.next(input(), signal())).rejects.toMatchObject({
			code: 'provider-incomplete'
		});
		expect(diagnostics.events.at(-1)).toMatchObject({
			event: 'report-parse',
			decision: 'incomplete-response'
		});
	});

	it('accepts split output_text JSON without relaxing report validation', async () => {
		const text = JSON.stringify(final());
		const reply = response([
			{
				...message(),
				content: [
					{ type: 'output_text', text: text.slice(0, 12) },
					{ type: 'output_text', text: text.slice(12) }
				]
			}
		]);
		const model = new MetaResponsesModel({
			apiKey: 'test-secret',
			transport: transport().mockResolvedValue(reply)
		});
		expect(await model.next(input(), signal())).toEqual(final());
	});

	it('retains successful analytical evidence when final text is malformed instead of inventing a report', async () => {
		const { AnalyticalRun } = await import('../../src/lib/server/investigation/analyticalRun');
		const { veXml, afrXml } = await import('./helpers');
		const run = new AnalyticalRun({
			contextId: 'parse-regression',
			logName: 'synthetic.msl',
			logContent: 'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1000\t50\t14',
			veXml,
			afrXml,
			calibrationId: 'confirmed',
			calibrationSemantics: 'rpm-map-kpa-afr'
		});
		const fetch = transport()
			.mockResolvedValueOnce(response([call()]))
			.mockResolvedValueOnce(response([message('not-json test-secret')]));
		try {
			const result = await runInvestigation(
				run,
				new MetaResponsesModel({ apiKey: 'test-secret', transport: fetch }),
				{ goal: 'Inspect', timeoutMs: 5000 }
			);
			expect(result.status).toBe('model_error');
			expect(result.termination?.code).toBe('provider-protocol');
			expect(result.trace).toHaveLength(1);
			expect(result.trace[0].result.ok).toBe(true);
			expect(result.report).toBeNull();
			expect(result.reason).not.toContain('test-secret');
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			await run.dispose();
		}
	});

	it('rejects invalid response JSON', async () => {
		const model = new MetaResponsesModel({
			apiKey: 'test',
			transport: transport().mockResolvedValue(new Response('not-json'))
		});
		await expect(model.next(input(), signal())).rejects.toThrow('not valid JSON');
	});

	it('rejects mismatched traces before sending another request', async () => {
		const fetch = transport().mockResolvedValue(response([call()]));
		const model = new MetaResponsesModel({ apiKey: 'test', transport: fetch });
		await model.next(input(), signal());
		await expect(
			model.next(input([{ ...traceEntry(), tool: 'assess_data_quality' }]), signal())
		).rejects.toThrow('does not match');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('lets the runner reject a final report with nonexistent citations', async () => {
		const fetch = transport()
			.mockResolvedValueOnce(response([call()]))
			.mockResolvedValueOnce(response([message(JSON.stringify(final(['forged'])))]));
		const result = await runInvestigation(
			context(),
			new MetaResponsesModel({ apiKey: 'test', transport: fetch }),
			{ goal: 'Investigate.' }
		);
		expect(result.status).toBe('invalid_response');
	});
});
