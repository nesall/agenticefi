import type { ChannelSlot } from '../../shared/types/channelMapping';
import type {
	EligibilityCheck,
	EligibilityConfig,
	EligibilityEvidence,
	EligibilityReason,
	EligibilityResult,
	EligibilitySummary,
	EligibilityThreshold,
	SampleEligibility
} from '../../shared/types/sampleEligibility';
import type { LogSession } from '../core/LogSession';

/** Initial engineering profile, not universal engine/sensor validity limits. */
export const DEFAULT_ELIGIBILITY_CONFIG: Readonly<EligibilityConfig> = Object.freeze({
	minCoolantC: 70,
	maxWarmupCorrectionDeviationPct: 1,
	maxAbsTpsRatePctPerSec: 5,
	maxAbsMapRateKpaPerSec: 10,
	maxAbsRpmRatePerSec: 200,
	maxGapSec: 0.5,
	steadyWindowSec: 1,
	possibleFuelCutMaxPulseWidthMs: 0.1,
	possibleFuelCutMinRpm: 1200,
	possibleFuelCutMaxTpsPct: 2
});
const checkNames: EligibilityCheck[] = [
	'core',
	'timeContinuity',
	'timeGap',
	'warmupTemperature',
	'warmupCorrection',
	'tpsTransient',
	'mapTransient',
	'rpmTransient',
	'possibleFuelCut',
	'steadyWindow'
];
const usedSlots: ChannelSlot[] = [
	'rpm',
	'load',
	'afr',
	'clt',
	'fuelwarmcor',
	'tps',
	'tpsDot',
	'mapDot',
	'pw'
];
const finite = (value: number): number | null => (Number.isFinite(value) ? value : null);

export function eligibilityConfig(overrides: Partial<EligibilityConfig> = {}): EligibilityConfig {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
		throw new TypeError('Eligibility config must be an object.');
	for (const [key, value] of Object.entries(overrides)) {
		if (!Object.hasOwn(DEFAULT_ELIGIBILITY_CONFIG, key))
			throw new Error(`Unknown eligibility config key: ${key}`);
		const nullable = ![
			'steadyWindowSec',
			'possibleFuelCutMinRpm',
			'possibleFuelCutMaxTpsPct'
		].includes(key);
		if (value === null && nullable) continue;
		if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			(key !== 'minCoolantC' && value < 0) ||
			(key === 'maxGapSec' && value === 0)
		)
			throw new RangeError(`Invalid eligibility threshold: ${key}`);
	}
	return { ...DEFAULT_ELIGIBILITY_CONFIG, ...overrides };
}

export function summarizeEligibility(samples: readonly SampleEligibility[]): EligibilitySummary {
	const summary: EligibilitySummary = {
		rowCount: samples.length,
		statuses: { 'hard-excluded': 0, 'heuristic-excluded': 0, indeterminate: 0, eligible: 0 },
		reasonCounts: {},
		checks: Object.fromEntries(
			checkNames.map((check) => [check, { pass: 0, fail: 0, unassessed: 0, disabled: 0 }])
		) as EligibilitySummary['checks']
	};
	for (const sample of samples) {
		summary.statuses[sample.status]++;
		for (const check of checkNames) summary.checks[check][sample.checks[check]]++;
		for (const code of new Set(sample.reasons.map((reason) => reason.code)))
			summary.reasonCounts[code] = (summary.reasonCounts[code] ?? 0) + 1;
	}
	return summary;
}

/** Pure classification of parsed samples. No table lookup, correction, or model
 * inference. Required core quantities are seconds, rpm, MAP kPa and measured AFR.
 */
export function classifySampleEligibility(
	session: LogSession,
	overrides: Partial<EligibilityConfig> = {}
): EligibilityResult {
	const config = eligibilityConfig(overrides);
	if (!Number.isSafeInteger(session.rowCount) || session.rowCount < 0)
		throw new Error('Invalid session row count.');
	const mapping = session.channelMapping;
	const resolutions = usedSlots.map((slot) => mapping.resolve(slot, session));
	const normalized = new Map<ChannelSlot, number[]>();
	for (const resolution of resolutions) {
		const values =
			resolution.status === 'resolved' ? session.findChannel(resolution.channelName)!.values : [];
		normalized.set(
			resolution.slot,
			Array.from({ length: session.rowCount }, (_, row) =>
				resolution.status === 'resolved' && Number.isFinite(values[row])
					? values[row] * resolution.scale + resolution.offset
					: NaN
			)
		);
	}
	const timeChannel = session.channelByIndex(session.timeChannelIndex ?? -1);
	const validTimeChannel =
		!!timeChannel &&
		!timeChannel.isBoolean &&
		!timeChannel.isTimestamp &&
		['s', 'sec', 'seconds'].includes(timeChannel.unit.trim().toLowerCase());
	const times = validTimeChannel ? timeChannel.values : [];
	const stitches = new Set(
		session.discontinuities.filter((d) => d.cause === 'StitchPoint').map((d) => d.rowIndex)
	);
	const samples: SampleEligibility[] = [];
	let highWater = -Infinity;
	let steadyStart: number | null = null;
	const value = (slot: ChannelSlot, row: number) => normalized.get(slot)?.[row] ?? NaN;
	const evidence = (slot: ChannelSlot, row: number): EligibilityEvidence => {
		const resolution = resolutions.find((r) => r.slot === slot)!;
		return {
			rowIndex: row,
			slot,
			channelName: resolution.status === 'unavailable' ? null : resolution.channelName,
			value: finite(value(slot, row)),
			unit: resolution.status === 'resolved' ? resolution.unit : null,
			method: 'normalized-sample'
		};
	};
	const threshold = (
		configKey: EligibilityThreshold['configKey'],
		operator: EligibilityThreshold['operator'],
		value: number,
		unit: string
	): EligibilityThreshold => ({ configKey, operator, value, unit });
	for (let row = 0; row < session.rowCount; row++) {
		const time = times[row];
		const previousTime = times[row - 1];
		const dt = time - previousTime;
		const ordered = Number.isFinite(time) && time > highWater;
		const contiguous =
			row > 0 &&
			ordered &&
			Number.isFinite(previousTime) &&
			Number.isFinite(dt) &&
			dt > 0 &&
			!stitches.has(row) &&
			samples[row - 1].checks.timeContinuity === 'pass' &&
			samples[row - 1].checks.core === 'pass' &&
			(config.maxGapSec === null || dt <= config.maxGapSec);
		const checks = Object.fromEntries(
			checkNames.map((check) => [check, 'pass'])
		) as SampleEligibility['checks'];
		const reasons: EligibilityReason[] = [];
		const add = (
			check: EligibilityCheck,
			category: EligibilityReason['category'],
			code: string,
			message: string,
			evidence: EligibilityEvidence[],
			thresholds: EligibilityThreshold[] = []
		) => {
			checks[check] = category === 'unassessed' ? 'unassessed' : 'fail';
			reasons.push({ check, category, code, message, evidence, thresholds });
		};
		const timeEvidence: EligibilityEvidence = {
			rowIndex: row,
			slot: 'time',
			channelName: timeChannel?.name ?? null,
			value: finite(time),
			unit: validTimeChannel ? 's' : (timeChannel?.unit ?? null),
			method: 'time',
			...(row ? { previousRowIndex: row - 1, previousValue: finite(previousTime) } : {})
		};
		if (!validTimeChannel || !Number.isFinite(time))
			add(
				'core',
				'hard',
				'TIME_UNAVAILABLE',
				'Time is missing, invalid, or not explicitly in seconds.',
				[timeEvidence]
			);
		for (const slot of ['rpm', 'load', 'afr'] as const) {
			const observed = value(slot, row);
			if (!Number.isFinite(observed) || observed <= 0)
				add(
					'core',
					'hard',
					`${slot.toUpperCase()}_UNUSABLE`,
					'Required core quantity must be resolved, finite, and positive.',
					[evidence(slot, row)],
					[
						threshold(
							'positiveCoreValue',
							'>',
							0,
							slot === 'load' ? 'kPa' : slot === 'rpm' ? 'rpm' : 'AFR'
						)
					]
				);
		}
		if (Number.isFinite(time)) {
			if (!ordered)
				add(
					'timeContinuity',
					'hard',
					'TIME_NOT_INCREASING',
					'Time does not exceed all preceding finite parsed timestamps.',
					[timeEvidence],
					[threshold('strictlyIncreasingTime', '>', highWater, 's')]
				);
			highWater = Math.max(highWater, time);
		} else checks.timeContinuity = 'unassessed';
		if (stitches.has(row))
			add(
				'timeContinuity',
				'hard',
				'STITCH_BOUNDARY',
				'A known stitch seam starts at this parsed sample.',
				[{ ...timeEvidence, method: 'stitch' }]
			);
		if (config.maxGapSec === null) checks.timeGap = 'disabled';
		else if (
			row > 0 &&
			Number.isFinite(time) &&
			Number.isFinite(previousTime) &&
			!Number.isFinite(dt)
		)
			add(
				'timeGap',
				'unassessed',
				'TIME_INTERVAL_UNUSABLE',
				'The adjacent time interval cannot be represented as a finite number.',
				[timeEvidence],
				[threshold('maxGapSec', '<=', config.maxGapSec, 's')]
			);
		else if (Number.isFinite(dt) && dt > config.maxGapSec)
			add(
				'timeGap',
				'heuristic',
				'TIME_GAP',
				'Adjacent parsed samples exceed the configured gap limit.',
				[{ ...timeEvidence, value: dt, sourceValue: time, deltaSec: dt, method: 'time-interval' }],
				[threshold('maxGapSec', '<=', config.maxGapSec, 's')]
			);

		const scalarCheck = (
			check: EligibilityCheck,
			slot: ChannelSlot,
			limit: number | null,
			key: keyof EligibilityConfig,
			unit: string,
			passes: (v: number) => boolean,
			code: string
		) => {
			if (limit === null) {
				checks[check] = 'disabled';
				return;
			}
			const observed = value(slot, row);
			const thresholds = [threshold(key, check === 'warmupTemperature' ? '>=' : '<=', limit, unit)];
			if (!Number.isFinite(observed))
				add(
					check,
					'unassessed',
					`${code}_UNASSESSED`,
					'Enabled check has no resolved finite sample.',
					[evidence(slot, row)],
					thresholds
				);
			else if (!passes(observed))
				add(
					check,
					'heuristic',
					code,
					'Sample fails the configured warmup criterion.',
					[
						check === 'warmupCorrection'
							? {
									...evidence(slot, row),
									sourceValue: observed,
									value: Math.abs(observed - 100),
									unit: 'percentage points from 100%',
									method: 'absolute-deviation'
								}
							: evidence(slot, row)
					],
					thresholds
				);
		};
		scalarCheck(
			'warmupTemperature',
			'clt',
			config.minCoolantC,
			'minCoolantC',
			'°C',
			(v) => v >= config.minCoolantC!,
			'COOLANT_BELOW_MINIMUM'
		);
		scalarCheck(
			'warmupCorrection',
			'fuelwarmcor',
			config.maxWarmupCorrectionDeviationPct,
			'maxWarmupCorrectionDeviationPct',
			'percentage points from 100%',
			(v) => Math.abs(v - 100) <= config.maxWarmupCorrectionDeviationPct!,
			'WARMUP_CORRECTION_ACTIVE'
		);

		const rateCheck = (
			check: EligibilityCheck,
			base: ChannelSlot,
			logged: ChannelSlot | null,
			limit: number | null,
			key: keyof EligibilityConfig,
			unit: string,
			code: string
		) => {
			if (limit === null) {
				checks[check] = 'disabled';
				return;
			}
			const observations: EligibilityEvidence[] = [];
			if (logged && Number.isFinite(value(logged, row)))
				observations.push({ ...evidence(logged, row), method: 'logged-rate' });
			if (
				contiguous &&
				Number.isFinite(value(base, row)) &&
				Number.isFinite(value(base, row - 1))
			) {
				const rate = (value(base, row) - value(base, row - 1)) / dt;
				if (Number.isFinite(rate))
					observations.push({
						...evidence(base, row),
						sourceValue: finite(value(base, row)),
						value: rate,
						unit,
						method: 'finite-difference',
						previousRowIndex: row - 1,
						previousValue: finite(value(base, row - 1)),
						deltaSec: dt
					});
			}
			const thresholds = [threshold(key, '<=', limit, `absolute ${unit}`)];
			if (!observations.length)
				add(
					check,
					'unassessed',
					`${code}_UNASSESSED`,
					'Neither a usable logged rate nor a contiguous finite-difference rate is available.',
					[evidence(base, row)],
					thresholds
				);
			else if (observations.some((item) => Math.abs(item.value!) > limit))
				add(
					check,
					'heuristic',
					code,
					'At least one supported rate exceeds the configured absolute limit.',
					observations,
					thresholds
				);
		};
		rateCheck(
			'tpsTransient',
			'tps',
			'tpsDot',
			config.maxAbsTpsRatePctPerSec,
			'maxAbsTpsRatePctPerSec',
			'%/s',
			'TPS_TRANSIENT'
		);
		rateCheck(
			'mapTransient',
			'load',
			'mapDot',
			config.maxAbsMapRateKpaPerSec,
			'maxAbsMapRateKpaPerSec',
			'kPa/s',
			'MAP_TRANSIENT'
		);
		rateCheck(
			'rpmTransient',
			'rpm',
			null,
			config.maxAbsRpmRatePerSec,
			'maxAbsRpmRatePerSec',
			'rpm/s',
			'RPM_TRANSIENT'
		);

		if (config.possibleFuelCutMaxPulseWidthMs === null) checks.possibleFuelCut = 'disabled';
		else {
			const observed = [evidence('pw', row), evidence('rpm', row), evidence('tps', row)];
			const thresholds = [
				threshold(
					'possibleFuelCutMaxPulseWidthMs',
					'<=',
					config.possibleFuelCutMaxPulseWidthMs,
					'ms'
				),
				threshold('possibleFuelCutMinRpm', '>=', config.possibleFuelCutMinRpm, 'rpm'),
				threshold('possibleFuelCutMaxTpsPct', '<=', config.possibleFuelCutMaxTpsPct, '%')
			];
			if (observed.some((item) => item.value === null || (item.slot === 'pw' && item.value < 0)))
				add(
					'possibleFuelCut',
					'unassessed',
					'FUEL_CUT_UNASSESSED',
					'Pulse width, RPM and TPS are required for this heuristic.',
					observed,
					thresholds
				);
			else if (
				value('pw', row) <= config.possibleFuelCutMaxPulseWidthMs &&
				value('rpm', row) >= config.possibleFuelCutMinRpm &&
				value('tps', row) <= config.possibleFuelCutMaxTpsPct
			)
				add(
					'possibleFuelCut',
					'heuristic',
					'POSSIBLE_FUEL_CUT',
					'Low primary pulse width with elevated RPM and closed throttle suggests possible fuel cut, not a confirmed ECU state.',
					observed,
					thresholds
				);
		}
		if (reasons.length) steadyStart = null;
		else if (steadyStart === null) steadyStart = Number.isFinite(time) ? time : null;
		if (config.steadyWindowSec === 0) checks.steadyWindow = 'disabled';
		else if (steadyStart === null || !Number.isFinite(time))
			add(
				'steadyWindow',
				'unassessed',
				'STEADY_WINDOW_UNASSESSED',
				'A contiguous run passing all enabled checks has not started.',
				[timeEvidence],
				[threshold('steadyWindowSec', '>=', config.steadyWindowSec, 's')]
			);
		else if (time - steadyStart < config.steadyWindowSec)
			add(
				'steadyWindow',
				'heuristic',
				'INSUFFICIENT_STEADY_HISTORY',
				'Passing samples have not yet covered the configured trailing steady duration.',
				[
					{
						rowIndex: row,
						slot: 'time',
						channelName: timeChannel?.name ?? null,
						value: time - steadyStart,
						sourceValue: time,
						windowStartSec: steadyStart,
						unit: 's',
						method: 'steady-duration'
					}
				],
				[threshold('steadyWindowSec', '>=', config.steadyWindowSec, 's')]
			);
		const status = reasons.some((r) => r.category === 'hard')
			? 'hard-excluded'
			: reasons.some((r) => r.category === 'heuristic')
				? 'heuristic-excluded'
				: reasons.some((r) => r.category === 'unassessed')
					? 'indeterminate'
					: 'eligible';
		samples.push({ rowIndex: row, timeSec: finite(time), status, checks, reasons });
	}
	return {
		classifierVersion: 'steady-afr-ve-v1',
		config,
		resolutions,
		samples,
		summary: summarizeEligibility(samples),
		limitations: [
			'Eligible means this configured screening profile passed, not proven steady state or a tuning recommendation.',
			'Initial thresholds require validation for the engine, logger, sensors and operating regime.',
			'Measured AFR is required; Lambda is not converted without an explicit fuel-specific convention.',
			'Logged rates and contiguous backward differences are both checked; either can exclude. Derivatives are not computed across invalid core samples, time breaks, or configured gaps.',
			'Fuel cut is only a primary-pulse-width/RPM/TPS hypothesis; secondary injection, ECU flags, sensor saturation and AFR transport delay are not interpreted.',
			'Classification uses parsed rows; skipped malformed rows and first-timestamp corrections cannot currently be audited from original-file diagnostics.'
		]
	};
}
