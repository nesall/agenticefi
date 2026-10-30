import { mkdir, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type {
	InvestigationTermination,
	TerminationCode
} from '../../shared/types/investigationDiagnostics';
import type { ToolName } from '../../shared/types/investigation';
import {
	providerErrorMetadata,
	providerValues,
	safeRequestId,
	type ProviderMetadata
} from './providerDiagnostics';

export class InvestigationFailure extends Error {
	constructor(
		public code: TerminationCode,
		message: string,
		public providerStatus?: number
	) {
		super(message);
	}
}

type EventName =
	| 'job-start'
	| 'runner-start'
	| 'model-start'
	| 'model-end'
	| 'model-request'
	| 'report-parse'
	| 'http-start'
	| 'http-end'
	| 'retry'
	| 'tool-start'
	| 'tool-end'
	| 'worker-start'
	| 'worker-exit'
	| 'worker-error'
	| 'worker-timeout'
	| 'evidence-expired'
	| 'presentation-failure'
	| 'session-expired'
	| 'cancel-requested'
	| 'runner-end'
	| 'recovery-offered'
	| 'recovery-skipped'
	| 'recovery-end'
	| 'recovery-guard'
	| 'job-end';
type Fields = ProviderMetadata & {
	continuation?: boolean;
	payloadBytes?: number;
	phase?: InvestigationTermination['phase'];
	tool?: string;
	outcome?: string;
	category?: TerminationCode;
	status?: number;
	elapsedMs?: number;
	attempt?: number;
	retryCount?: number;
	retryDelayMs?: number | null;
	decision?: string;
	exitCode?: number;
	runnerStatus?: string;
};
const tools = new Set<ToolName>([
	'describe_log',
	'summarize_window',
	'assess_data_quality',
	'assess_sample_eligibility',
	'analyze_afr_error',
	'fit_ve_candidate',
	'evaluate_ve_candidate'
]);
export const diagnosticTool = (value: string): ToolName | null =>
	tools.has(value as ToolName) ? (value as ToolName) : null;
const categories = new Set<TerminationCode>([
	'completed',
	'deadline',
	'cancelled',
	'session-expired',
	'provider-http',
	'provider-network',
	'provider-protocol',
	'provider-incomplete',
	'worker-failure',
	'worker-timeout',
	'invalid-report',
	'incomplete-workflow',
	'limit-reached',
	'setup-failure',
	'presentation-failure'
]);
const outcomes = new Set([
	'completed',
	'failed',
	'interrupted',
	'tool',
	'final',
	'disposed',
	'unexpected',
	'timeout',
	'cancelled'
]);
const decisions = new Set([
	'incomplete-response',
	'invalid-output',
	'refusal',
	'empty-report',
	'oversized-report',
	'fenced-json',
	'invalid-json',
	'non-object-json',
	'invalid-report-kind',
	'offered',
	'completed',
	'failed',
	'still-incomplete',
	'already-attempted',
	'no-candidate',
	'not-applicable',
	'not-supported',
	'no-tool-budget',
	'no-turn-budget',
	'refit-prohibited',
	'candidate-locked',
	'retry',
	'disabled',
	'not-transient',
	'exhausted',
	'retry-after-exceeds-cap'
]);
const statuses = new Set([
	'completed',
	'limit_reached',
	'invalid_response',
	'model_error',
	'timeout',
	'cancelled'
]);
export type DiagnosticEvent = {
	event: EventName;
	at: string;
	jobId: string;
	runId: string | null;
	modelTurn: number;
	remainingMs: number | null;
} & Fields;
type Options = {
	directory?: string;
	now?: () => number;
	observe?: (event: DiagnosticEvent) => void;
	persist?: boolean;
};
let writes: Promise<unknown> = Promise.resolve();

/** Metadata allowlist only. Never retains prompts, tool contents, raw headers or error bodies. */
export class InvestigationDiagnostics {
	#jobId = '';
	#runId: string | null = null;
	#turn = 0;
	#attempt = 0;
	#deadline: number | null = null;
	#events: DiagnosticEvent[] = [];
	#dropped = 0;
	#finished = false;
	#directory: string;
	#persistenceWarned = false;
	constructor(private options: Options = {}) {
		this.#directory = resolve(
			options.directory ??
				(process.env.AGENTICEFI_DIAGNOSTICS_DIR?.trim() || '.investigation-diagnostics')
		);
	}
	get events(): readonly DiagnosticEvent[] {
		return structuredClone(this.#events);
	}
	bind(jobId: string) {
		if (!/^[a-f0-9-]{36}$/.test(jobId) || this.#jobId)
			throw new Error('Invalid diagnostic job identity.');
		this.#jobId = jobId;
		this.event('job-start');
	}
	start(runId: string, timeoutMs: number) {
		this.#runId = /^[a-f0-9-]{36}$/.test(runId) ? runId : null;
		this.#deadline = this.now() + timeoutMs;
		this.event('runner-start');
	}
	turn(value: number) {
		this.#turn = value;
		this.#attempt = 0;
	}
	nextAttempt() {
		return ++this.#attempt;
	}
	now() {
		return (this.options.now ?? Date.now)();
	}
	event(event: EventName, fields: Fields = {}) {
		try {
			if (!this.#jobId || this.#finished) return;
			const safe: Fields = {};
			for (const key of Object.keys(providerValues) as (keyof typeof providerValues)[]) {
				const value = fields[key];
				if (typeof value === 'string' && providerValues[key].has(value)) safe[key] = value;
			}
			if (safeRequestId(fields.providerRequestId))
				safe.providerRequestId = fields.providerRequestId;
			if (typeof fields.continuation === 'boolean') safe.continuation = fields.continuation;
			if (
				fields.phase &&
				['preparing', 'model', 'tool', 'report', 'presentation', 'finished'].includes(fields.phase)
			)
				safe.phase = fields.phase;
			if (fields.tool && diagnosticTool(fields.tool)) safe.tool = fields.tool;
			if (fields.category && categories.has(fields.category)) safe.category = fields.category;
			if (fields.outcome && outcomes.has(fields.outcome)) safe.outcome = fields.outcome;
			if (fields.decision && decisions.has(fields.decision)) safe.decision = fields.decision;
			if (fields.runnerStatus && statuses.has(fields.runnerStatus))
				safe.runnerStatus = fields.runnerStatus;
			for (const key of [
				'status',
				'elapsedMs',
				'attempt',
				'retryCount',
				'retryDelayMs',
				'exitCode',
				'payloadBytes'
			] as const) {
				const value = fields[key];
				if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
			}
			const record: DiagnosticEvent = {
				event,
				at: new Date(this.now()).toISOString(),
				jobId: this.#jobId,
				runId: this.#runId,
				modelTurn: this.#turn,
				remainingMs: this.#deadline === null ? null : Math.max(0, this.#deadline - this.now()),
				...safe
			};
			if (this.#events.length >= 160) {
				this.#events.splice(1, 1);
				this.#dropped++;
			}
			this.#events.push(record);
			try {
				this.options.observe?.(structuredClone(record));
			} catch {
				/* Observers cannot affect execution. */
			}
			if (this.options.persist !== false) {
				const directory = this.#directory;
				const body = JSON.stringify(
					{ version: 1, jobId: this.#jobId, droppedEvents: this.#dropped, events: this.#events },
					null,
					2
				);
				const name = this.#jobId + '.json';
				writes = writes
					.catch(() => {})
					.then(async () => {
						await mkdir(directory, { recursive: true, mode: 0o700 });
						await writeFile(join(directory, name + '.tmp'), body, { mode: 0o600 });
						await rename(join(directory, name + '.tmp'), join(directory, name));
						const files = await readdir(directory);
						const retained = await Promise.all(
							files
								.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
								.map(async (n) => ({ n, time: (await stat(join(directory, n))).mtimeMs }))
						);
						for (const file of retained.sort((a, b) => b.time - a.time).slice(32))
							await unlink(join(directory, file.n));
					})
					.catch(() => {
						// One fixed warning per recorder; never expose filesystem errors or paths.
						if (this.#persistenceWarned) return;
						this.#persistenceWarned = true;
						try {
							console.warn(
								'[AgenticEFI] Investigation diagnostics persistence failed; in-memory diagnostics retained.'
							);
						} catch {
							/* Even a logging failure cannot change the investigation. */
						}
					});
			}
		} catch {
			/* Logging is best effort, including clock and serialization failures. */
		}
	}
	finish(termination: InvestigationTermination, runnerStatus?: string) {
		this.event('job-end', {
			phase: termination.phase,
			status: termination.providerStatus,
			category: termination.code,
			tool: termination.tool ?? undefined,
			runnerStatus
		});
		this.#finished = true;
	}
	async flush() {
		await writes;
	}
}

/** One event per HTTP attempt; bounded allowlisted provider error metadata only. */
export function diagnosticTransport(
	transport: typeof fetch,
	diagnostics: InvestigationDiagnostics
): typeof fetch {
	return async (input, init) => {
		const attempt = diagnostics.nextAttempt(),
			start = performance.now();
		diagnostics.event('http-start', { attempt });
		try {
			const response = await transport(input, init);
			diagnostics.event('http-end', {
				attempt,
				status: response.status,
				elapsedMs: performance.now() - start,
				outcome: response.ok ? 'completed' : 'failed',
				...(response.ok ? {} : { category: 'provider-http' as const }),
				...(response.ok ? {} : await providerErrorMetadata(response))
			});
			return response;
		} catch (error) {
			diagnostics.event('http-end', {
				attempt,
				elapsedMs: performance.now() - start,
				category: init?.signal?.aborted ? 'cancelled' : 'provider-network',
				outcome: 'failed'
			});
			throw error;
		}
	};
}
