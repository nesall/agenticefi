import type { InvestigationModel, ToolTraceEntry } from '../../shared/types/investigation';
import { metaApiKey } from './metaApiKey';
import { InvestigationFailure, type InvestigationDiagnostics } from './diagnostics';
import { createHash } from 'node:crypto';
import type { AnalyticalFeedback } from './analyticalRecovery';

export const META_MODEL = 'muse-spark-1.3-contributor';
const endpoint = 'https://api.meta.ai/v1/responses';
type ModelInput = Parameters<InvestigationModel['next']>[0];
type PendingCall = { callId: string; name: string; argumentsJson: string; traceLength: number };

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Meta returned an invalid response object.');
	return value as Record<string, unknown>;
}
function nonempty(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && !!value.trim() && value.length <= maximum;
}

/** One instance per investigation. Uses stored Responses history to preserve
 * reasoning items, while only sending tool summaries and metadata to Meta.
 * No API key, headers, or raw provider error bodies are included in diagnostics.
 */
export class MetaResponsesModel implements InvestigationModel {
	#apiKey: string;
	#transport: typeof fetch;
	#responseId: string | null = null;
	#pending: PendingCall | null = null;
	#busy = false;
	#finished = false;
	#lastError: string | null = null;
	#analyticalFinalTrace: string | null = null;
	#recoveryUsed = false;
	#feedback: AnalyticalFeedback | null = null;
	#diagnostics?: InvestigationDiagnostics;

	constructor(
		options: {
			apiKey?: string;
			transport?: typeof fetch;
			diagnostics?: InvestigationDiagnostics;
		} = {}
	) {
		const key = options.apiKey ?? metaApiKey();
		if (!key?.trim()) throw new Error('META_HACKATHON_API_KEY is not set.');
		this.#apiKey = key.trim();
		this.#transport = options.transport ?? fetch;
		this.#diagnostics = options.diagnostics;
	}
	get lastError(): string | null {
		return this.#lastError;
	}
	async continueAnalyticalFinal(
		input: ModelInput,
		feedback: AnalyticalFeedback,
		signal: AbortSignal
	): Promise<unknown> {
		if (
			this.#busy ||
			!this.#finished ||
			!this.#responseId ||
			this.#pending ||
			this.#recoveryUsed ||
			input.reportMode !== 'analytical' ||
			!this.#analyticalFinalTrace ||
			this.#analyticalFinalTrace !==
				createHash('sha256').update(JSON.stringify(input.trace)).digest('hex')
		)
			throw new InvestigationFailure(
				'provider-protocol',
				'Analytical final continuation is unavailable or its trace changed.'
			);
		if (signal.aborted) throw new InvestigationFailure('cancelled', 'Meta request cancelled.');
		this.#recoveryUsed = true;
		this.#feedback = structuredClone(feedback);
		this.#finished = false;
		return this.next(input, signal);
	}

	async next(input: ModelInput, signal: AbortSignal): Promise<unknown> {
		if (this.#busy) throw new Error('Concurrent Meta model calls are unsupported.');
		this.#busy = true;
		this.#lastError = null;
		try {
			return await this.request(input, signal);
		} catch (error) {
			this.#finished = true;
			const failure =
				error instanceof InvestigationFailure
					? error
					: new InvestigationFailure(
							signal.aborted ? 'cancelled' : 'provider-protocol',
							error instanceof Error ? error.message : 'Meta adapter failed.'
						);
			this.#lastError = failure.message;
			throw failure;
		} finally {
			this.#busy = false;
		}
	}

	private async request(input: ModelInput, signal: AbortSignal): Promise<unknown> {
		if (this.#finished) throw new Error('Create a new MetaResponsesModel for each investigation.');
		if (signal.aborted) throw new Error('Meta request cancelled.');
		let apiInput: unknown = input.goal;
		if (this.#feedback) {
			apiInput = [
				{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(this.#feedback) }] }
			];
			this.#feedback = null;
		} else if (this.#pending) {
			const pending = this.#pending;
			const entry: ToolTraceEntry | undefined = input.trace.at(-1);
			if (
				!entry ||
				input.trace.length !== pending.traceLength + 1 ||
				entry.tool !== pending.name ||
				JSON.stringify(entry.arguments) !== pending.argumentsJson
			) {
				throw new Error('Tool trace does not match the pending Meta call.');
			}
			apiInput = [
				{
					type: 'function_call_output',
					call_id: pending.callId,
					output: JSON.stringify({ evidenceId: entry.evidenceId, ...entry.result })
				}
			];
		} else if (this.#responseId || input.trace.length) {
			throw new Error('Create a new MetaResponsesModel for each investigation.');
		}
		const reportInstruction =
			input.reportMode === 'analytical'
				? 'Your final assistant message must be raw JSON (no markdown): {"kind":"final","factIds":["server fact IDs"],"commentary":[{"kind":"hypothesis","text":"Unverified model hypothesis","evidenceIds":["evidence-1"]}]}. Never invent fact IDs. Numerical facts are rendered by the server; commentary is unverified.'
				: 'Your final assistant message must be raw JSON (no markdown): {"kind":"final","findings":[{"statement":"...","evidenceIds":["evidence-1"]}],"limitations":["..."]}. Do not include reasoning in that JSON.';
		const body = {
			model: META_MODEL,
			input: apiInput,
			...(this.#responseId ? { previous_response_id: this.#responseId } : {}),
			instructions: `${input.instructions}\nUse native function calls for tools, never JSON text that imitates a tool call. ${input.reportMode === 'analytical' ? 'You may inspect data or fit directly; canonical analysis is prepared lazily.' : 'Call describe_log first to discover bounds and units.'}\nTool output contains its evidenceId; cite only those IDs. You have ${input.remainingCalls} tool calls remaining. If none remain, produce your report.\n${reportInstruction}`,
			tools: input.tools.map((tool) => ({
				type: 'function',
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema
			})),
			tool_choice: 'auto',
			parallel_tool_calls: false,
			store: true,
			max_output_tokens: 4096
		};
		const encodedBody = JSON.stringify(body);
		this.#diagnostics?.event('model-request', {
			continuation: this.#responseId !== null,
			payloadBytes: Buffer.byteLength(encodedBody),
			...(this.#pending && !this.#feedback ? { tool: this.#pending.name } : {})
		});
		let response: Response;
		try {
			response = await this.#transport(endpoint, {
				method: 'POST',
				headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
				body: encodedBody,
				signal,
				redirect: 'error'
			});
		} catch {
			throw new InvestigationFailure(
				signal.aborted ? 'cancelled' : 'provider-network',
				'Meta request failed (network or cancellation).'
			);
		}
		if (!response.ok)
			throw new InvestigationFailure(
				'provider-http',
				`Meta API returned HTTP ${response.status}.`,
				response.status
			);
		let decoded: unknown;
		try {
			decoded = await response.json();
		} catch {
			throw new Error('Meta response was not valid JSON.');
		}
		const payload = record(decoded);
		if (
			payload.status !== 'completed' ||
			payload.error != null ||
			payload.incomplete_details != null
		)
			throw new InvestigationFailure(
				'provider-incomplete',
				'Meta response failed or was incomplete.'
			);
		if (!nonempty(payload.id, 256) || !Array.isArray(payload.output))
			throw new Error('Meta response is missing its ID or output.');
		const output = payload.output.map(record);
		if (
			output.some((item) => !['function_call', 'message', 'reasoning'].includes(String(item.type)))
		)
			throw new Error('Meta returned an unsupported output item.');
		const calls = output.filter((item) => item.type === 'function_call');
		if (calls.length > 1)
			throw new Error('Meta returned multiple tool calls despite sequential mode.');
		if (calls.length) {
			const call = calls[0];
			if (
				!nonempty(call.call_id, 64) ||
				!nonempty(call.name, 2000) ||
				typeof call.arguments !== 'string' ||
				call.arguments.length > 16000 ||
				(call.status !== undefined && call.status !== 'completed')
			)
				throw new Error('Meta returned an invalid function call.');
			let args: unknown;
			try {
				args = JSON.parse(call.arguments);
			} catch {
				throw new Error('Meta function arguments were not valid JSON.');
			}
			this.#responseId = payload.id;
			this.#pending = {
				callId: call.call_id,
				name: call.name,
				argumentsJson: JSON.stringify(args),
				traceLength: input.trace.length
			};
			return { kind: 'tool', name: call.name, arguments: args };
		}
		const texts: string[] = [];
		for (const item of output.filter((item) => item.type === 'message')) {
			if (item.role !== 'assistant' || !Array.isArray(item.content))
				throw new Error('Meta returned an invalid assistant message.');
			for (const value of item.content) {
				const part = record(value);
				if (part.type !== 'output_text' || typeof part.text !== 'string')
					throw new Error('Meta returned no usable final report text.');
				texts.push(part.text);
			}
		}
		const text = texts.join('');
		if (!text || Buffer.byteLength(text) > 20000)
			throw new Error('Meta report is empty or exceeds 20 KB.');
		let final: Record<string, unknown>;
		try {
			final = record(JSON.parse(text));
		} catch {
			throw new Error('Meta final report was not a JSON object.');
		}
		if (final.kind !== 'final')
			throw new Error(
				'Meta must use native function calls for tools and JSON only for the final report.'
			);
		this.#responseId = payload.id;
		this.#pending = null;
		this.#analyticalFinalTrace =
			input.reportMode === 'analytical'
				? createHash('sha256').update(JSON.stringify(input.trace)).digest('hex')
				: null;
		this.#finished = true;
		return final;
	}
}
