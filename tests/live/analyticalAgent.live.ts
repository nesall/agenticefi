import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AnalyticalRun } from '../../src/lib/server/investigation/analyticalRun';
import { analyticalArguments } from '../../src/lib/server/investigation/analyticalProtocol';
import {
	MetaResponsesModel,
	META_MODEL
} from '../../src/lib/server/investigation/metaResponsesModel';
import { metaApiKey } from '../../src/lib/server/investigation/metaApiKey';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import type { InvestigationResult, JsonValue } from '../../src/lib/shared/types/investigation';
import type { VeFitResult } from '../../src/lib/shared/types/veFitting';
import type {
	VeEvaluationDataset,
	VeCandidateEvaluation,
	ManualVeCandidate
} from '../../src/lib/shared/types/veEvaluation';
import {
	sanitizedJson,
	smokeOutcome,
	tokenCount,
	summarizeUsage,
	smokeCheck,
	persistSmokeReport,
	terminalHttpStatuses,
	type SmokeCheck
} from './analyticalSmokeSupport';
import {
	retryingTransport,
	safeResponseHeaders,
	MAX_RETRIES,
	type RetryEvent
} from './analyticalSmokeTransport';
import {
	smokeSelection,
	loadSmokeDataset,
	SmokeDatasetUnavailable,
	SmokeResourceUnavailable
} from './analyticalSmokeDatasets';

type ApiTurn = {
	turn: number;
	modelTurn: number;
	attempt: number;
	requestIds: Record<string, string>;
	retryAfter: string | null;
	retry: RetryEvent | null;
	httpStatus: number | null;
	elapsedMs: number;
	responseId: string | null;
	status: string | null;
	output: unknown[];
	usage: {
		input: number | null;
		output: number | null;
		total: number | null;
		cachedInput: number | null;
		reasoningOutput: number | null;
	};
	observation: string | null;
};
const object = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const required = ['analyze_afr_error', 'fit_ve_candidate', 'evaluate_ve_candidate'];
const limits = { maxToolCalls: 6, maxIterations: 7, timeoutMs: 120000 };
const resilient = process.env.AGENTICEFI_SMOKE_RESILIENT === 'true';
if (
	process.env.AGENTICEFI_SMOKE_RESILIENT !== undefined &&
	!['true', 'false'].includes(process.env.AGENTICEFI_SMOKE_RESILIENT)
)
	throw new Error('Invalid smoke resilience flag.');
const maxRetries = resilient ? MAX_RETRIES : 0;
// Invalid selections fail before credentials or transport are used.
const selection = smokeSelection(
	process.env.AGENTICEFI_SMOKE_DATASET,
	process.env.AGENTICEFI_SMOKE_PROFILE,
	process.env.AGENTICEFI_SMOKE_WORKER_HEAP_MB
);

it(`LIVE: ${selection.dataset} ${selection.profile} analytical investigation with genuine Muse-selected calls`, async () => {
	const started = performance.now();
	const startedAt = new Date().toISOString();
	const reportId = process.env.AGENTICEFI_SMOKE_REPORT_ID ?? randomUUID();
	if (!/^[a-f0-9-]{36}$/.test(reportId)) throw new Error('Invalid smoke report ID.');
	const turns: ApiTurn[] = [];
	const checks: SmokeCheck[] = [];
	const check = (name: string, passed: boolean, assessed = true) =>
		checks.push(smokeCheck(name, passed, assessed));
	let modelTurns = 0;
	let run: AnalyticalRun | undefined;
	let model: MetaResponsesModel | undefined;
	let result: InvestigationResult | null = null;
	let setupBlocker: string | null = null;
	let datasetUnavailable = false;
	let resourceUnavailable = false;
	let evidenceError: string | null = null;
	let summary: unknown = null;
	const verifiedRefs: string[] = [];
	const key = metaApiKey();
	// Real network transport only. Observe a clone; return the original untouched to the adapter.
	const observe: typeof fetch = async (input, init) => {
		if (turns.length >= limits.maxIterations * (maxRetries + 1))
			throw new Error('Live HTTP attempt ceiling reached.');
		const turn: ApiTurn = {
			turn: turns.length + 1,
			modelTurn: modelTurns,
			attempt: turns.filter((item) => item.modelTurn === modelTurns).length + 1,
			requestIds: {},
			retryAfter: null,
			retry: null,
			httpStatus: null,
			elapsedMs: 0,
			responseId: null,
			status: null,
			output: [],
			usage: { input: null, output: null, total: null, cachedInput: null, reasoningOutput: null },
			observation: null
		};
		turns.push(turn);
		const requestStart = performance.now();
		try {
			const response = await fetch(input, init);
			turn.httpStatus = response.status;
			Object.assign(turn, safeResponseHeaders(response.headers));
			// Only allowlisted diagnostic headers. Never log request headers/body, error bodies or reasoning.
			if (response.ok) {
				try {
					const payload = object(await response.clone().json());
					turn.responseId = typeof payload.id === 'string' ? payload.id.slice(0, 256) : null;
					turn.status = typeof payload.status === 'string' ? payload.status.slice(0, 60) : null;
					const usage = object(payload.usage);
					turn.usage = {
						input: tokenCount(usage.input_tokens),
						output: tokenCount(usage.output_tokens),
						total: tokenCount(usage.total_tokens),
						cachedInput: tokenCount(object(usage.input_tokens_details).cached_tokens),
						reasoningOutput: tokenCount(object(usage.output_tokens_details).reasoning_tokens)
					};
					turn.output = (Array.isArray(payload.output) ? payload.output : [])
						.slice(0, 8)
						.flatMap<unknown>((value) => {
							const item = object(value);
							if (item.type === 'function_call')
								return [
									{
										type: item.type,
										name: item.name,
										call_id: item.call_id,
										arguments: String(item.arguments).slice(0, 16000)
									}
								];
							if (item.type === 'message')
								return [
									{
										type: item.type,
										role: item.role,
										content: (Array.isArray(item.content) ? item.content : [])
											.slice(0, 4)
											.map((part) => {
												const p = object(part);
												return {
													type: p.type,
													text: typeof p.text === 'string' ? p.text.slice(0, 20000) : null
												};
											})
									}
								];
							return [];
						});
				} catch {
					turn.observation = 'Provider success payload was not readable as JSON.';
				}
			}
			return response;
		} catch {
			turn.observation =
				'Network request failed or was cancelled; ambiguous network failures are not retried.';
			throw new Error('Live network request failed.');
		} finally {
			turn.elapsedMs = performance.now() - requestStart;
		}
	};
	const retryTransport = retryingTransport(observe, {
		maxRetries,
		onDecision: (event) => {
			turns.at(-1)!.retry = event;
		}
	});
	const transport: typeof fetch = async (input, init) => {
		if (modelTurns >= limits.maxIterations) throw new Error('Live model turn ceiling reached.');
		modelTurns++;
		return retryTransport(input, init);
	};
	try {
		// Check associated local sources before any network request, without substituting calibrations.
		const input = loadSmokeDataset(selection);
		if (!key) {
			setupBlocker = 'No supported server environment API credential is configured.';
		} else {
			run = new AnalyticalRun(input);
			// Deterministic negative controls, separate from actual model calls and its six-call budget.
			for (const [name, args] of [
				['analyze_afr_error', { rowIndices: [1, 1] }],
				['fit_ve_candidate', { corrections: [] }],
				['evaluate_ve_candidate', {}]
			] as const) {
				let rejected = false;
				try {
					analyticalArguments(name, args);
				} catch {
					rejected = true;
				}
				check(`offline validation rejects ${name} negative control`, rejected);
			}
			model = new MetaResponsesModel({ transport });
			result = await runInvestigation(run, model, {
				...limits,
				goal: `Run a bounded advisory investigation of the ${selection.dataset} RX-7 log using the frozen ${selection.version} profile. Use all three analytical tools: analyze_afr_error to inspect training-region evidence, fit_ve_candidate to finalize the one frozen candidate, and evaluate_ve_candidate with its returned candidateRef to inspect paired holdout predictions. You may choose regions and optional inspection tools in any valid order; fitting may prepare analysis lazily. No-supported-proposal, unchanged candidates, insufficient holdout coverage, and worsened holdout predictions are legitimate; do not seek nonzero corrections or change settings. Finish with returned server fact IDs and your evidence-linked commentary explaining coverage and limitations. Conditional predictions are not measured improvements and do not authorize ECU writes.`
			});
			const interrupted = ['model_error', 'timeout', 'cancelled'].includes(result.status);
			check(
				'runner completed a final report',
				result.status === 'completed' && result.report !== null,
				!interrupted
			);
			const successful = result.trace.filter((entry) => entry.result.ok);
			for (const name of required)
				check(
					`model selected successful ${name}`,
					successful.some((entry) => entry.tool === name),
					!interrupted || result.trace.some((entry) => entry.tool === name)
				);
			const native = turns
				.flatMap((turn) => turn.output)
				.map(object)
				.filter((item) => item.type === 'function_call');
			check(
				'every executed call originates in an actual native provider call',
				native.length === result.trace.length &&
					native.every((call, i) => {
						try {
							return (
								call.name === result!.trace[i].tool &&
								JSON.stringify(JSON.parse(String(call.arguments))) ===
									JSON.stringify(result!.trace[i].arguments)
							);
						} catch {
							return false;
						}
					}),
				result.trace.length > 0 || !interrupted
			);
			for (const entry of result.trace) {
				let valid = true;
				try {
					analyticalArguments(entry.tool, entry.arguments);
				} catch {
					valid = false;
				}
				check(`selected arguments validated: ${entry.evidenceId}`, valid);
			}
			check(
				'no tool failures',
				successful.length === result.trace.length,
				result.trace.length > 0 || !interrupted
			);
			const refs = result.analytical?.evidenceRefs ?? [];
			const evidence = new Map<string, unknown>();
			for (const ref of refs) {
				try {
					check(
						`same-run provenance: ${ref.kind}`,
						ref.runId === run.runId &&
							ref.contextId === run.contextId &&
							ref.settingsId === run.settingsId
					);
					evidence.set(ref.artifactId, await run.getEvidence(ref)); // Full content checksum verified here.
					verifiedRefs.push(ref.artifactId);
				} catch {
					evidenceError = 'Full evidence retrieval or checksum verification failed.';
				}
			}
			check(
				'all returned full evidence references verified',
				refs.length > 0 && refs.length === verifiedRefs.length,
				refs.length > 0 || !interrupted
			);
			for (const kind of ['analysis', 'fit', 'candidate', 'evaluation'])
				check(
					`retained ${kind} evidence`,
					refs.some((ref) => ref.kind === kind && evidence.has(ref.artifactId)),
					refs.some((ref) => ref.kind === kind) || !interrupted
				);
			const find = (kind: string) =>
				evidence.get(refs.find((ref) => ref.kind === kind)?.artifactId ?? '');
			const dataset = find('analysis') as VeEvaluationDataset | undefined;
			const fit = find('fit') as VeFitResult | undefined;
			const candidate = find('candidate') as ManualVeCandidate | undefined;
			const evaluation = find('evaluation') as VeCandidateEvaluation | undefined;
			if (selection.dataset === 'april' && selection.profile === 'v1')
				check(
					'April V1 unsupported-cell outcome preserved',
					dataset?.coverage.supportedCells === 0 && fit?.status === 'no-supported-proposal',
					!!dataset && !!fit
				);
			check(
				'fit finalized a valid bounded candidate',
				!!fit &&
					!!candidate &&
					['candidate', 'no-supported-proposal'].includes(fit.status) &&
					candidate.changedCells.every(
						(cell) =>
							Number.isFinite(cell.percent) &&
							Math.abs(cell.percent) <= fit.bounds.effectiveMaxPct &&
							fit.cells.some(
								(decision) =>
									decision.rpmIndex === cell.rpmIndex &&
									decision.mapIndex === cell.mapIndex &&
									decision.status === 'accepted'
							)
					),
				!!fit && !!candidate
			);
			if (fit?.status === 'no-supported-proposal' || dataset?.coverage.supportedCells === 0)
				check(
					'unsupported/no-proposal candidate remains unchanged',
					!!candidate &&
						candidate.changedCells.length === 0 &&
						candidate.correctionFractions.every((row) => row.every((value) => value === 0))
				);
			check(
				'paired holdout uses canonical rows without prediction failures',
				!!evaluation &&
					evaluation.partition === 'holdout' &&
					evaluation.paired.rowCount === dataset?.coverage.holdoutRows &&
					evaluation.paired.failedPredictions === 0 &&
					(evaluation.paired.rowCount === 0
						? evaluation.paired.status === 'empty'
						: evaluation.paired.status === 'complete' &&
							evaluation.paired.baseline.count === evaluation.paired.candidate?.count),
				!!evaluation && !!dataset
			);
			if (candidate?.changedCells.length === 0 && evaluation && evaluation.paired.rowCount > 0)
				check(
					'unchanged candidate has identical paired metrics',
					evaluation.paired.baseline.mae === evaluation.paired.candidate?.mae &&
						evaluation.paired.baseline.rmse === evaluation.paired.candidate?.rmse
				);
			check(
				'artifact identities link analysis fit candidate and evaluation',
				!!dataset &&
					fit?.datasetId === dataset.datasetId &&
					candidate?.datasetId === dataset.datasetId &&
					evaluation?.datasetId === dataset.datasetId &&
					fit?.candidate.candidateId === candidate?.candidateId &&
					evaluation?.candidateId === candidate?.candidateId,
				!!dataset && !!fit && !!candidate && !!evaluation
			);
			const fitIndex = result.trace.findIndex(
				(entry) => entry.tool === 'fit_ve_candidate' && entry.result.ok
			);
			const evaluationIndex = result.trace.findIndex(
				(entry) => entry.tool === 'evaluate_ve_candidate' && entry.result.ok
			);
			const fittedData = fitIndex >= 0 ? object(successData(result.trace[fitIndex].result)) : {};
			check(
				'evaluation follows finalization with the returned candidate reference',
				fitIndex >= 0 &&
					evaluationIndex > fitIndex &&
					object(result.trace[evaluationIndex].arguments).candidateRef === fittedData.candidateRef,
				evaluationIndex >= 0 || !interrupted
			);
			const cited = new Set(successful.map((entry) => entry.evidenceId));
			const facts = run.facts;
			check(
				'server facts match authoritative findings',
				!!result.report?.findings.length &&
					result.report.findings.every(
						(finding) =>
							finding.verification === 'server-numerical' &&
							finding.evidenceIds.every((id) => cited.has(id)) &&
							facts.some(
								(fact) =>
									fact.statement === finding.statement &&
									finding.evidenceIds.includes(fact.evidenceId)
							)
					),
				!!result.report || !interrupted
			);
			check(
				'model commentary is separate and evidence linked',
				!!result.report?.commentary?.length &&
					result.report.commentary.every(
						(item) =>
							item.verification === 'unverified-model-commentary' &&
							item.evidenceIds.length > 0 &&
							item.evidenceIds.every((id) => cited.has(id))
					),
				!!result.report || !interrupted
			);
			check(
				'final report remains advisory',
				result.report?.advisoryOnly === true,
				!!result.report || !interrupted
			);
			summary = {
				coverage: dataset?.coverage,
				split: dataset?.split,
				episodes: dataset?.episodes.length,
				fitStatus: fit?.status,
				changedCells: candidate?.changedCells.length,
				paired: evaluation?.paired,
				facts,
				settings: run.settings
			};
		}
	} catch (error) {
		datasetUnavailable = error instanceof SmokeDatasetUnavailable;
		resourceUnavailable = error instanceof SmokeResourceUnavailable;
		setupBlocker =
			datasetUnavailable || resourceUnavailable
				? (error as Error).message
				: 'Smoke harness setup or verification failed; no whole-run retry performed.';
	} finally {
		await run?.dispose();
	}
	const failedChecks = checks.filter((item) => item.status === 'failed').map((item) => item.name);
	const notRunChecks = checks.filter((item) => item.status === 'not-run').map((item) => item.name);
	const outcome = resourceUnavailable
		? 'resource-limit'
		: datasetUnavailable
			? 'dataset-unavailable'
			: !key
				? 'authentication-or-access-blocker'
				: smokeOutcome(
						terminalHttpStatuses(turns),
						model?.lastError ?? setupBlocker ?? evidenceError,
						result?.status === 'completed',
						failedChecks
					);
	const report = {
		source: 'LIVE Meta API; no mocks, replay, or scripted model calls',
		startedAt,
		reportId,
		model: META_MODEL,
		selection,
		outcome,
		resilience: {
			enabled: resilient,
			maxRetriesPerModelTurn: maxRetries,
			modelTurns,
			httpAttempts: turns.length,
			retriesScheduled: turns.filter((t) => t.retry?.decision === 'retry').length,
			recoveredModelTurns: [...new Set(turns.map((t) => t.modelTurn))].filter((id) => {
				const attempts = turns.filter((t) => t.modelTurn === id);
				const last = attempts.at(-1)!;
				return (
					attempts.length > 1 &&
					last.httpStatus !== null &&
					last.httpStatus >= 200 &&
					last.httpStatus < 300
				);
			}).length
		},
		limits: {
			...limits,
			workerHeapMb: selection.workerHeapMb,
			maxOutputTokensPerResponse: 4096,
			theoreticalMaxOutputTokens: 4096 * limits.maxIterations * (maxRetries + 1),
			maxHttpAttempts: limits.maxIterations * (maxRetries + 1),
			automaticRetriesPerModelTurn: maxRetries
		},
		elapsedMs: performance.now() - started,
		setupBlocker,
		adapterError: model?.lastError ?? null,
		evidenceError,
		usage: {
			...summarizeUsage(turns),
			estimatedCost: null,
			costLimitation:
				'No authoritative per-model pricing is configured; no cost estimate invented. Usage includes reasoning output when provider counts it.'
		},
		actualModelResponses: turns,
		deterministicValidationChecks: checks,
		failedChecks,
		notRunChecks,
		verifiedEvidenceReferences: verifiedRefs,
		deterministicAnalysis: summary,
		validatedInvestigation: result,
		limitations: [
			`One ${selection.dataset} ${selection.profile} run tests integration, not tuning accuracy or profile superiority.`,
			'Tool results and server facts are deterministic calculations; provider messages and native calls are actual model outputs.',
			'AFR delay is zero and predictions are conditional; no ECU write or measured improvement is authorized.',
			'Retried POST requests can consume provider resources or incur charges more than once; unavailable usage and cost are not inferred.'
		]
	};
	const paths = persistSmokeReport(
		selection.reportPath,
		startedAt,
		reportId,
		sanitizedJson(report, [
			key ?? '',
			process.env.META_HACKATHON_API_KEY ?? '',
			process.env.META_API_KEY ?? ''
		]) + '\n'
	);
	console.info(
		'Single LIVE analytical smoke:',
		JSON.stringify({
			outcome,
			requests: turns.length,
			modelTurns,
			elapsedMs: report.elapsedMs,
			usage: report.usage,
			adapterError: report.adapterError,
			setupBlocker,
			failedChecks,
			notRunChecks,
			report: paths.latestPath,
			archive: paths.archivePath
		})
	);
	expect(outcome, `See sanitized ${paths.archivePath}; no whole-run retry was performed.`).toBe(
		'passed'
	);
});

function successData(result: { ok: boolean; data?: JsonValue }): JsonValue | undefined {
	return result.ok ? result.data : undefined;
}
