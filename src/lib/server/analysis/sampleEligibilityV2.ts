import type { LogSession } from '../core/LogSession';
import type { CategoricalEvidence, CutObservation } from '../msl/parseMslWithEligibilityEvidence';
import type { EligibilityConfig, EligibilityStatus } from '../../shared/types/sampleEligibility';
import type {
	ExperimentalEligibilityConfig,
	ExperimentalEligibilityResult,
	ExperimentalReason,
	ExperimentalSample,
	StabilityWindow
} from '../../shared/types/sampleEligibilityV2';
import { classifySampleEligibility } from './sampleEligibility';

/** Fixed initial experiment, not validated engine limits. No AFR transport-delay adjustment. */
export const DEFAULT_EXPERIMENTAL_CONFIG: Readonly<ExperimentalEligibilityConfig> = Object.freeze({
	rpmMethod: 'windowed',
	windowAlignment: 'centered',
	windowSec: 1,
	maxAbsSlopeRpmPerSec: 200,
	maxCentralSpreadRpm: 100,
	maxRangeRpm: 150,
	maxAdjacentJumpRpm: 50,
	minObservations: 9,
	maxObservationGapSec: 0.2,
	maxEndpointBracketSec: 0.1,
	requireFuelCutEvidence: true,
	requireOverrunFuelCutEvidence: true
});

export function experimentalConfig(
	overrides: Partial<ExperimentalEligibilityConfig> = {}
): ExperimentalEligibilityConfig {
	for (const [key, value] of Object.entries(overrides)) {
		if (!Object.hasOwn(DEFAULT_EXPERIMENTAL_CONFIG, key))
			throw new Error(`Unknown experimental config: ${key}`);
		if (key === 'rpmMethod') {
			if (value !== 'adjacent' && value !== 'windowed') throw new Error('Invalid RPM method');
		} else if (key === 'windowAlignment') {
			if (value !== 'trailing' && value !== 'centered') throw new Error('Invalid alignment');
		} else if (key.startsWith('require')) {
			if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
		} else if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value < 0 ||
			(['windowSec', 'maxObservationGapSec'].includes(key) && value === 0) ||
			(key === 'minObservations' && (!Number.isSafeInteger(value) || value < 2))
		)
			throw new Error(`Invalid ${key}`);
	}
	return { ...DEFAULT_EXPERIMENTAL_CONFIG, ...overrides };
}

/** Type-7 quantiles; Theil–Sen uses every distinct-time pair, without subsampling. */
export function rpmWindowMetrics(times: readonly number[], rpm: readonly number[]) {
	if (
		times.length !== rpm.length ||
		times.length < 2 ||
		rpm.some((v) => !Number.isFinite(v)) ||
		times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))
	)
		throw new Error('Invalid RPM support');
	const quantile = (sorted: number[], p: number) => {
		const position = (sorted.length - 1) * p;
		const lower = Math.floor(position);
		return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
	};
	const slopes: number[] = [];
	for (let j = 0; j < times.length; j++)
		for (let k = j + 1; k < times.length; k++)
			slopes.push((rpm[k] - rpm[j]) / (times[k] - times[j]));
	if (slopes.some((s) => !Number.isFinite(s))) throw new Error('Unrepresentable RPM slope');
	slopes.sort((a, b) => a - b);
	const sorted = [...rpm].sort((a, b) => a - b);
	return {
		slopeRpmPerSec: quantile(slopes, 0.5),
		centralSpreadRpm: quantile(sorted, 0.9) - quantile(sorted, 0.1),
		rangeRpm: sorted.at(-1)! - sorted[0]
	};
}

export function classifyExperimentalEligibility(
	session: LogSession,
	options: {
		config?: Partial<ExperimentalEligibilityConfig>;
		baseConfig?: Partial<EligibilityConfig>;
		categorical?: CategoricalEvidence;
		partition?: { startRow: number; endRowExclusive: number };
	} = {}
): ExperimentalEligibilityResult {
	const config = experimentalConfig(options.config);
	const partition = options.partition ?? { startRow: 0, endRowExclusive: session.rowCount };
	const { startRow, endRowExclusive } = partition;
	if (
		!Number.isSafeInteger(startRow) ||
		!Number.isSafeInteger(endRowExclusive) ||
		startRow < 0 ||
		endRowExclusive > session.rowCount ||
		endRowExclusive < startRow
	)
		throw new Error('Invalid partition');
	const categorical = options.categorical;
	if (
		categorical &&
		(categorical.session !== session ||
			categorical.fuelCut.length !== session.rowCount ||
			categorical.overrunFuelCut.length !== session.rowCount)
	)
		throw new Error('Categorical evidence does not belong to this session');
	// Reuse the unchanged V1 base rules and global high-water time audit. Its RPM and dwell
	// reasons are deliberately removed; the controls below supply those two decisions.
	const base = classifySampleEligibility(session, options.baseConfig);
	const rpmResolution = session.channelMapping.resolve('rpm', session);
	const rpm =
		rpmResolution.status === 'resolved'
			? session
					.findChannel(rpmResolution.channelName)!
					.values.map((v) => v * rpmResolution.scale + rpmResolution.offset)
			: Array(session.rowCount).fill(NaN);
	const points: ExperimentalSample[] = base.samples.map((sample) => ({
		rowIndex: sample.rowIndex,
		timeSec: sample.timeSec,
		status: 'indeterminate',
		window: null,
		baseReasons: sample.reasons.filter(
			(r) => r.check !== 'rpmTransient' && r.check !== 'steadyWindow'
		),
		reasons: [],
		categorical: {
			fuelCut: {
				state: 'absent',
				raw: null,
				sourceLine: null,
				required: config.requireFuelCutEvidence
			},
			overrunFuelCut: {
				state: 'absent',
				raw: null,
				sourceLine: null,
				required: config.requireOverrunFuelCutEvidence
			}
		}
	}));
	const add = (
		row: number,
		code: string,
		category: ExperimentalReason['category'],
		evidence: Record<string, unknown>,
		blocking = true
	) => points[row].reasons.push({ code, category, evidence, blocking });
	for (let row = startRow; row < endRowExclusive; row++) {
		for (const [key, observations, required] of [
			['FUEL_CUT', categorical?.fuelCut, config.requireFuelCutEvidence],
			['OVERRUN_FUEL_CUT', categorical?.overrunFuelCut, config.requireOverrunFuelCutEvidence]
		] as const) {
			const observed: CutObservation = observations?.[row] ?? {
				state: 'absent',
				raw: null,
				sourceLine: null
			};
			points[row].categorical[key === 'FUEL_CUT' ? 'fuelCut' : 'overrunFuelCut'] = {
				...observed,
				required
			};
			if (observed.state === 'active')
				add(row, `${key}_ACTIVE`, 'heuristic', { ...observed, required });
			else if (observed.state !== 'inactive')
				add(row, `${key}_UNASSESSED`, 'unassessed', { ...observed, required }, required);
		}
		if (row === startRow && startRow > 0)
			add(row, 'PARTITION_DERIVATIVE_UNASSESSED', 'unassessed', { startRow });
		const previous = points[row - 1];
		const previousTime = previous?.timeSec;
		const dt =
			points[row].timeSec !== null && typeof previousTime === 'number'
				? points[row].timeSec! - previousTime
				: NaN;
		const continuous =
			row > startRow &&
			Number.isFinite(dt) &&
			dt > 0 &&
			base.samples[row].checks.timeContinuity === 'pass' &&
			base.samples[row - 1].checks.timeContinuity === 'pass';
		if (continuous && dt > config.maxObservationGapSec)
			add(row, 'OBSERVATION_GAP', 'heuristic', {
				previousRowIndex: row - 1,
				deltaSec: dt,
				maxObservationGapSec: config.maxObservationGapSec
			});
		if (
			continuous &&
			dt <= config.maxObservationGapSec &&
			Number.isFinite(rpm[row]) &&
			Number.isFinite(rpm[row - 1]) &&
			rpm[row] > 0 &&
			rpm[row - 1] > 0 &&
			Math.abs(rpm[row] - rpm[row - 1]) > config.maxAdjacentJumpRpm
		)
			add(row, 'RPM_JUMP_BOUNDARY', 'heuristic', {
				previousRowIndex: row - 1,
				previousRpm: rpm[row - 1],
				rpm: rpm[row],
				deltaRpm: rpm[row] - rpm[row - 1],
				maxAdjacentJumpRpm: config.maxAdjacentJumpRpm
			});
		if (config.rpmMethod === 'adjacent')
			for (const reason of base.samples[row].reasons.filter((r) => r.check === 'rpmTransient'))
				add(row, reason.code, reason.category, { reason });
	}
	const blocked = (row: number) =>
		points[row].baseReasons.length > 0 || points[row].reasons.some((r) => r.blocking);
	// Fixed pointwise partitions, never recursively segmented on window failures.
	const segments: { start: number; end: number }[] = [];
	for (let row = startRow; row < endRowExclusive;) {
		if (blocked(row)) {
			row++;
			continue;
		}
		const start = row++;
		while (row < endRowExclusive && !blocked(row)) row++;
		segments.push({ start, end: row - 1 });
	}
	for (const segment of segments) {
		let left = segment.start,
			right = segment.start;
		for (let row = segment.start; row <= segment.end; row++) {
			const t = points[row].timeSec!;
			const requestedStartSec =
				t - (config.windowAlignment === 'centered' ? config.windowSec / 2 : config.windowSec);
			const requestedEndSec =
				t + (config.windowAlignment === 'centered' ? config.windowSec / 2 : 0);
			while (left < segment.end && points[left + 1].timeSec! <= requestedStartSec) left++;
			while (right < segment.end && points[right].timeSec! < requestedEndSec) right++;
			const a = points[left].timeSec!,
				b = points[right].timeSec!;
			const window: StabilityWindow = {
				requestedStartSec,
				requestedEndSec,
				startRow: left,
				endRow: right,
				actualStartSec: a,
				actualEndSec: b,
				observationCount: right - left + 1
			};
			points[row].window = window;
			// A derivative at the first point after a blocked transition can depend on
			// that excluded predecessor, even if a logged rate also exists. Do not use
			// that point as support. This is fixed segmentation, not a recursive veto.
			const derivativeTouchesBoundary = left === segment.start && segment.start > startRow;
			if (
				a > requestedStartSec ||
				b < requestedEndSec ||
				requestedStartSec - a > config.maxEndpointBracketSec ||
				b - requestedEndSec > config.maxEndpointBracketSec ||
				window.observationCount < config.minObservations ||
				derivativeTouchesBoundary
			) {
				const boundary = (index: number) =>
					index >= startRow && index < endRowExclusive
						? {
								rowIndex: index,
								codes: [
									...points[index].baseReasons,
									...points[index].reasons.filter((r) => r.blocking)
								].map((r) => r.code)
							}
						: null;
				add(row, 'STABILITY_SUPPORT_UNASSESSED', 'unassessed', {
					...window,
					segmentStartRow: segment.start,
					segmentEndRow: segment.end,
					precedingBoundary: boundary(segment.start - 1),
					followingBoundary: boundary(segment.end + 1),
					derivativeTouchesBoundary,
					minObservations: config.minObservations,
					maxEndpointBracketSec: config.maxEndpointBracketSec
				});
				continue;
			}
			try {
				Object.assign(
					window,
					rpmWindowMetrics(
						points.slice(left, right + 1).map((p) => p.timeSec!),
						rpm.slice(left, right + 1)
					)
				);
			} catch {
				add(row, 'RPM_METRICS_UNASSESSED', 'unassessed', { ...window });
				continue;
			}
			if (config.rpmMethod === 'windowed')
				for (const [code, value, limit] of [
					['RPM_WINDOW_SLOPE', Math.abs(window.slopeRpmPerSec!), config.maxAbsSlopeRpmPerSec],
					['RPM_WINDOW_SPREAD', window.centralSpreadRpm!, config.maxCentralSpreadRpm],
					['RPM_WINDOW_RANGE', window.rangeRpm!, config.maxRangeRpm]
				] as const)
					if (value > limit)
						add(row, code, 'heuristic', { ...window, observed: value, maximum: limit });
		}
	}
	const statuses: Record<EligibilityStatus, number> = {
		'hard-excluded': 0,
		'heuristic-excluded': 0,
		indeterminate: 0,
		eligible: 0
	};
	const reasonCounts: Record<string, number> = {};
	const samples = points.slice(startRow, endRowExclusive);
	for (const point of samples) {
		const categories = [
			...point.baseReasons.map((r) => r.category),
			...point.reasons.filter((r) => r.blocking).map((r) => r.category)
		];
		point.status = categories.includes('hard')
			? 'hard-excluded'
			: categories.includes('heuristic')
				? 'heuristic-excluded'
				: categories.includes('unassessed')
					? 'indeterminate'
					: 'eligible';
		statuses[point.status]++;
		for (const code of new Set([
			...point.baseReasons.map((r) => r.code),
			...point.reasons.map((r) => r.code)
		]))
			reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
	}
	return {
		classifierVersion: 'steady-afr-ve-v2-experimental',
		config,
		baseConfig: base.config,
		partition: { ...partition },
		samples,
		summary: { statuses, reasonCounts }
	};
}
