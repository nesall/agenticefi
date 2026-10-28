import { randomUUID } from 'node:crypto';
import { AnalyticalRun } from './investigation/analyticalRun';
import { curatedDemo } from './demo/catalog';
import { recordedInvestigation, recordedProfiles } from './recordedInvestigation';
import type { DemoId, AnalyticalProfile } from '../shared/types/analyticalDashboard';
import { metaApiKey } from './investigation/metaApiKey';
import type { InvestigationDiagnostics } from './investigation/diagnostics';
import { assessAnalyticalWorkflow } from './investigation/analyticalRecovery';
import { classifySampleEligibility, summarizeEligibility } from './analysis/sampleEligibility';
import { runInvestigation } from './investigation/runner';
import type { InvestigationContext } from './investigation/context';
import type { InvestigationModel } from '../shared/types/investigation';
import type { ChannelSlot } from '../shared/types/channelMapping';
import type { EligibilityResult, EligibilityStatus } from '../shared/types/sampleEligibility';
import type {
	EligibilityPage,
	InvestigationJob,
	PlotPoint,
	SessionSummary,
	TelemetryResponse
} from '../shared/types/dashboard';

export class DashboardError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}
type StoredSession = {
	id: string;
	owner: string;
	context: InvestigationContext;
	classification: EligibilityResult;
	demoId?: DemoId;
	expiresAt: number;
};
type StoredRun = {
	diagnostics?: InvestigationDiagnostics;
	owner: string;
	job: InvestigationJob;
	abort: AbortController;
	analytical?: AnalyticalRun;
	expiresAt: number;
};
const statuses: EligibilityStatus[] = [
	'eligible',
	'hard-excluded',
	'heuristic-excluded',
	'indeterminate'
];

/** Process-local demo storage. Restarting the server discards sessions and runs. */
export class DashboardStore {
	#sessions = new Map<string, StoredSession>();
	#runs = new Map<string, StoredRun>();
	#classificationCache = new WeakMap<InvestigationContext['session'], EligibilityResult>();
	constructor(
		private options = {
			ttlMs: 30 * 60 * 1000,
			maxSessions: 8,
			maxRuns: 16,
			maxActiveRuns: 2,
			now: () => Date.now()
		}
	) {}
	private clean() {
		const now = this.options.now();
		for (const [id, session] of this.#sessions)
			if (session.expiresAt <= now) this.#sessions.delete(id);
		for (const [id, run] of this.#runs)
			if (run.expiresAt <= now || !this.#sessions.has(run.job.sessionId)) {
				run.diagnostics?.event('session-expired', { category: 'session-expired' });
				run.job.termination = {
					code: 'session-expired',
					phase: 'finished',
					modelTurn: run.job.result?.termination?.modelTurn ?? 0,
					tool: null
				};
				run.abort.abort();
				this.#runs.delete(id);
			}
	}
	create(owner: string, context: InvestigationContext, demoId?: DemoId): SessionSummary {
		this.clean();
		const existing = [...this.#sessions.values()].find(
			(session) => session.owner === owner && session.context.logName === context.logName
		);
		if (existing) return this.summary(owner, existing.id);
		if (this.#sessions.size >= this.options.maxSessions)
			throw new DashboardError(
				429,
				'Demo capacity reached. Please try again after existing sessions expire.'
			);
		const id = randomUUID();
		let classification = this.#classificationCache.get(context.session);
		if (!classification) {
			classification = classifySampleEligibility(context.session, context.eligibilityProfile);
			this.#classificationCache.set(context.session, classification);
		}
		const session: StoredSession = {
			demoId,
			id,
			owner,
			context: { ...context, id },
			classification,
			expiresAt: this.options.now() + this.options.ttlMs
		};
		this.#sessions.set(id, session);
		return this.summary(owner, id);
	}
	private get(owner: string, id: string): StoredSession {
		this.clean();
		const session = this.#sessions.get(id);
		if (!session || session.owner !== owner)
			throw new DashboardError(404, 'Session is unavailable or expired. Load the demo again.');
		return session;
	}
	summary(owner: string, id: string): SessionSummary {
		const stored = this.get(owner, id),
			{ context, classification } = stored,
			session = context.session;
		const times = session.timeSec()?.filter(Number.isFinite) ?? [];
		if (!times.length) throw new DashboardError(422, 'The demo has no usable time axis.');
		return {
			demoId: stored.demoId,
			recordings: stored.demoId ? recordedProfiles(stored.demoId) : [],
			id,
			logName: context.logName,
			calibrationId: context.calibrationId,
			rowCount: session.rowCount,
			channelCount: session.channels.length,
			logEncoding: context.logEncoding,
			expiresAt: stored.expiresAt,
			startSec: Math.min(...times),
			endSec: Math.max(...times),
			mappings: Object.keys(session.channelMapping.toJSON()).map((slot) =>
				session.channelMapping.resolve(slot as ChannelSlot, session)
			),
			profile: { ...classification.config },
			eligibility: structuredClone(classification.summary),
			calibrations: (
				[
					{ kind: 'VE', source: context.ve },
					{ kind: 'AFR', source: context.afr }
				] as const
			).map(({ kind, source }) => ({
				kind,
				rows: source.table.rowCount,
				columns: source.table.columnCount,
				writeDate: source.writeDate ?? null
			})),
			limitations: [...context.limitations, ...classification.limitations],
			museAvailable: !!metaApiKey()
		};
	}
	private bounds(startSec: number, endSec: number) {
		if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec > endSec)
			throw new DashboardError(400, 'Choose finite, ordered time bounds.');
	}
	telemetry(
		owner: string,
		id: string,
		slots: ChannelSlot[],
		startSec: number,
		endSec: number
	): TelemetryResponse {
		this.bounds(startSec, endSec);
		const { context, classification } = this.get(owner, id),
			session = context.session;
		const known = Object.keys(session.channelMapping.toJSON());
		if (
			slots.length < 1 ||
			slots.length > 6 ||
			new Set(slots).size !== slots.length ||
			slots.some((slot) => !known.includes(slot))
		)
			throw new DashboardError(400, 'Select 1–6 unique known telemetry channels.');
		const resolutions = slots.map((slot) => session.channelMapping.resolve(slot, session));
		const sources = resolutions.map((r) =>
			r.status === 'resolved' ? session.findChannel(r.channelName)!.values : []
		);
		const times = session.timeSec() ?? [];
		const seams = new Set(session.discontinuities.map((d) => d.rowIndex));
		const segments: PlotPoint[][] = [];
		let current: PlotPoint[] = [];
		let previousTime: number | null = null;
		let pointCount = 0;
		const split = () => {
			if (current.length) segments.push(current);
			current = [];
		};
		for (let row = 0; row < session.rowCount; row++) {
			const time = times[row];
			if (!Number.isFinite(time)) {
				split();
				previousTime = null;
				continue;
			}
			if (
				previousTime !== null &&
				(time <= previousTime ||
					seams.has(row) ||
					(classification.config.maxGapSec !== null &&
						time - previousTime > classification.config.maxGapSec))
			)
				split();
			previousTime = time;
			if (time < startSec || time > endSec) {
				split();
				continue;
			}
			if (++pointCount > 8000)
				throw new DashboardError(
					413,
					'This window has more than 8,000 points. Choose a smaller window; samples are never silently downsampled.'
				);
			current.push({
				rowIndex: row,
				timeSec: time,
				status: classification.samples[row].status,
				values: resolutions.map((r, i) => {
					const raw = sources[i][row];
					const value =
						r.status === 'resolved' && Number.isFinite(raw) ? raw * r.scale + r.offset : NaN;
					return Number.isFinite(value) ? value : null;
				})
			});
		}
		split();
		return {
			sessionId: id,
			startSec,
			endSec,
			slots,
			resolutions,
			segments,
			pointCount,
			invalidTimeCount: classification.samples.filter((s) => s.timeSec === null).length
		};
	}
	eligibility(
		owner: string,
		id: string,
		query: {
			startSec: number;
			endSec: number;
			offset?: number;
			limit?: number;
			status?: string;
			reason?: string;
			focusRow?: number;
			includeInvalidTime?: boolean;
		}
	): EligibilityPage {
		this.bounds(query.startSec, query.endSec);
		const { classification } = this.get(owner, id);
		const { offset = 0, limit = 25, status, reason, focusRow } = query;
		if (
			!Number.isInteger(offset) ||
			offset < 0 ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			(status && !statuses.includes(status as EligibilityStatus)) ||
			(reason && reason.length > 100) ||
			(focusRow !== undefined &&
				(!Number.isInteger(focusRow) || focusRow < 0 || focusRow >= classification.samples.length))
		)
			throw new DashboardError(400, 'Invalid sample filter or page.');
		const window = classification.samples.filter((sample) =>
			sample.timeSec !== null
				? sample.timeSec >= query.startSec && sample.timeSec <= query.endSec
				: query.includeInvalidTime
		);
		const filtered = window.filter(
			(s) =>
				(!status || s.status === status) && (!reason || s.reasons.some((r) => r.code === reason))
		);
		return structuredClone({
			sessionId: id,
			summary: summarizeEligibility(window),
			fullSummary: classification.summary,
			profile: classification.config,
			samples: filtered.slice(offset, offset + limit),
			total: filtered.length,
			offset,
			limit,
			focusedSample: focusRow === undefined ? null : classification.samples[focusRow],
			unlocatableTimeCount: classification.samples.filter((s) => s.timeSec === null).length
		});
	}
	start(
		owner: string,
		id: string,
		input: {
			goal: string;
			startSec: number;
			endSec: number;
			mode?: 'legacy' | 'analytical';
			profile?: AnalyticalProfile;
			source?: 'live' | 'recorded';
		},
		model: InvestigationModel | null,
		diagnostic: () => string | null = () => null,
		diagnostics?: InvestigationDiagnostics
	): InvestigationJob {
		this.bounds(input.startSec, input.endSec);
		const session = this.get(owner, id);
		const summary = this.summary(owner, id);
		if (
			typeof input.goal !== 'string' ||
			!input.goal.trim() ||
			input.goal.length > 3000 ||
			input.startSec < summary.startSec ||
			input.endSec > summary.endSec
		)
			throw new DashboardError(400, 'Provide a goal and a time window inside this log.');
		const runs = [...this.#runs.values()];
		if (input.mode !== 'analytical' && input.profile && input.profile !== 'v1')
			throw new DashboardError(400, 'Legacy inspection uses V1 screening.');
		if (!model && input.source !== 'recorded')
			throw new DashboardError(503, 'Muse Spark is not configured.');
		if (
			(input.mode && !['legacy', 'analytical'].includes(input.mode)) ||
			(input.profile && !['v1', 'v2-experimental'].includes(input.profile)) ||
			(input.source && !['live', 'recorded'].includes(input.source))
		)
			throw new DashboardError(400, 'Invalid investigation selection.');
		if (input.mode !== 'analytical' && input.source === 'recorded')
			throw new DashboardError(400, 'Recordings require analytical mode.');
		if (input.mode === 'analytical' && !session.demoId)
			throw new DashboardError(400, 'Analytical dashboard runs require a curated demo.');
		if (
			input.mode === 'analytical' &&
			input.source !== 'recorded' &&
			runs.some((r) => r.job.mode === 'analytical' && r.job.state === 'running')
		)
			throw new DashboardError(429, 'One analytical dashboard investigation can run at a time.');
		if (runs.some((r) => r.owner === owner && r.job.sessionId === id && r.job.state === 'running'))
			throw new DashboardError(409, 'An investigation is already running for this session.');
		if (
			this.#runs.size >= this.options.maxRuns ||
			runs.filter((r) => r.job.state === 'running').length >= this.options.maxActiveRuns
		)
			throw new DashboardError(429, 'Investigation capacity reached. Please try again later.');
		const job: InvestigationJob = {
			logName: session.context.logName,
			calibrationId: session.context.calibrationId,
			demoId: session.demoId,
			rowCount: session.context.session.rowCount,
			mode: input.mode ?? 'legacy',
			source: input.source ?? 'live',
			profile: input.profile ?? 'v1',
			progress: { phase: 'preparing', tool: null, completed: [] },
			presentation: null,
			id: randomUUID(),
			sessionId: id,
			state: 'running',
			startedAt: this.options.now(),
			finishedAt: null,
			startSec: input.startSec,
			endSec: input.endSec,
			result: null,
			error: null
		};
		const run: StoredRun = {
			diagnostics,
			owner,
			job,
			abort: new AbortController(),
			expiresAt: session.expiresAt
		};
		this.#runs.set(job.id, run);
		diagnostics?.bind(job.id);
		if (input.mode === 'analytical') {
			void this.investigateAnalytically(run, session, input, model, diagnostic);
			return structuredClone(job);
		}
		if (!model) throw new DashboardError(503, 'Muse Spark is not configured.');
		void runInvestigation(session.context, model, {
			goal: `${input.goal}\nRequested parsed-time window: ${input.startSec} to ${input.endSec} seconds. Use describe_log, summarize_window, assess_data_quality, and assess_sample_eligibility as appropriate. Keep the configured screening limitations explicit.`,
			maxIterations: 10,
			maxToolCalls: 7,
			timeoutMs: 300000,
			signal: run.abort.signal
		})
			.then((result) => {
				job.result = result;
				job.state = 'finished';
				job.finishedAt = this.options.now();
				job.error = result.status === 'completed' ? null : (diagnostic() ?? result.reason);
			})
			.catch(() => {
				job.state = 'finished';
				job.finishedAt = this.options.now();
				job.error = 'The investigation could not complete. Please try again.';
			});
		return structuredClone(job);
	}
	private async investigateAnalytically(
		run: StoredRun,
		session: StoredSession,
		input: { goal: string; profile?: AnalyticalProfile; source?: 'live' | 'recorded' },
		model: InvestigationModel | null,
		diagnostic: () => string | null
	) {
		const job = run.job;
		try {
			if (input.source === 'recorded') {
				const snapshot = await recordedInvestigation(
					session.demoId!,
					input.profile ?? 'v1',
					session.context
				);
				if (run.abort.signal.aborted) throw new Error('Cancelled.');
				job.result = snapshot.result;
				job.presentation = snapshot.presentation;
				job.recordedAt = snapshot.recordedAt;
			} else {
				const demo = await curatedDemo(session.demoId!);
				if (!model) throw new Error('Muse Spark is not configured.');
				if (run.abort.signal.aborted) throw new Error('Cancelled.');
				const state = new AnalyticalRun(
					{
						...demo.input,
						contextId: session.id,
						profile: {
							version:
								input.profile === 'v2-experimental'
									? 'steady-afr-ve-v2-experimental'
									: 'steady-afr-ve-v1'
						}
					},
					{ diagnostics: run.diagnostics, checkpointPresentation: true }
				);
				run.analytical = state;
				job.result = await runInvestigation(state, model, {
					goal: `${input.goal}\nInvestigate the whole canonical log using analyze_afr_error, fit_ve_candidate, and evaluate_ve_candidate when supported. Do not change frozen settings or treat chart selection as a fitting mask. Report missing evidence, legitimate no-correction outcomes and worsened holdout predictions.`,
					maxIterations: 7,
					maxToolCalls: 6,
					timeoutMs: 120000,
					diagnostics: run.diagnostics,
					signal: run.abort.signal,
					onProgress: (progress) => {
						job.progress = progress;
					}
				});
				if (job.termination?.code !== 'session-expired') job.termination = job.result.termination;
				job.presentation = state.presentationCheckpoint;
				if (
					(!job.presentation || state.presentationCheckpointIncomplete) &&
					!run.abort.signal.aborted &&
					state.manifest.evidenceRefs.length
				) {
					try {
						job.presentation = await state.getPresentation(run.abort.signal);
					} catch {
						run.diagnostics?.event('presentation-failure', { category: 'presentation-failure' });
						if (job.result.status === 'completed')
							job.termination = {
								code: 'presentation-failure',
								phase: 'presentation',
								modelTurn: job.result.termination?.modelTurn ?? 0,
								tool: null
							};
						job.error =
							'Some analytical details are unavailable after a worker failure or resource limit.';
					}
				}
				if (job.result.status !== 'completed')
					job.error =
						job.result.status === 'model_error'
							? (job.result.reason ?? diagnostic())
							: job.result.reason;
				const workflow =
					job.result.status === 'completed'
						? assessAnalyticalWorkflow(state, job.result.trace)
						: null;
				if (workflow && !workflow.complete && !workflow.verifiedBlocker) {
					job.termination = {
						code: 'incomplete-workflow',
						phase: 'report',
						modelTurn: job.result.termination?.modelTurn ?? 0,
						tool: null
					};
					job.error =
						'The agent finished without completing all analytical stages. Available evidence is shown; missing sections remain unavailable.';
				}
				if (state.failureCategory && job.result.status === 'completed') {
					job.termination = {
						code: state.failureCategory,
						phase: 'tool',
						modelTurn: job.result.termination?.modelTurn ?? 0,
						tool: job.result.termination?.tool ?? null
					};
					job.error =
						state.failureCategory === 'worker-timeout'
							? 'Analytical worker time budget exceeded. Completed evidence is retained.'
							: 'Analytical worker failed. Completed evidence is retained; unfinished stages are unavailable.';
				}
			}
		} catch {
			job.termination ??= {
				code: run.abort.signal.aborted ? 'cancelled' : 'setup-failure',
				phase: 'preparing',
				modelTurn: 0,
				tool: null
			};
			job.error = run.abort.signal.aborted
				? 'Investigation cancelled.'
				: 'The investigation or recording is unavailable. No replacement results were generated.';
		} finally {
			await run.analytical?.dispose();
			run.analytical = undefined;
			job.state = 'finished';
			job.outcome = run.abort.signal.aborted
				? 'cancelled'
				: job.error
					? 'failed'
					: job.result?.status === 'completed'
						? 'completed'
						: 'failed';
			job.finishedAt = this.options.now();
			run.diagnostics?.finish(
				job.termination ?? {
					code: job.error ? 'setup-failure' : 'completed',
					phase: 'finished',
					modelTurn: 0,
					tool: null
				},
				job.result?.status
			);
			job.progress = {
				phase: 'finished',
				tool: null,
				completed: job.result?.trace ?? job.progress?.completed ?? []
			};
		}
	}
	cancel(owner: string, id: string): InvestigationJob {
		this.clean();
		const run = this.#runs.get(id);
		if (!run || run.owner !== owner)
			throw new DashboardError(404, 'Investigation is unavailable or expired.');
		run.abort.abort();
		run.diagnostics?.event('cancel-requested', { category: 'cancelled' });
		void run.analytical?.dispose();
		return structuredClone(run.job);
	}
	job(owner: string, id: string): InvestigationJob {
		this.clean();
		const run = this.#runs.get(id);
		if (!run || run.owner !== owner)
			throw new DashboardError(404, 'Investigation is unavailable or expired.');
		return structuredClone(run.job);
	}
}
export const dashboardStore = new DashboardStore();
