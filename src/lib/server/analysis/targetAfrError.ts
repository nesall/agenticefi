import type { LogSession } from '../core/LogSession';
import type { TunerStudioTableMetadata } from '../msl/importTunerStudioXml';
import type {
	AfrEligibility,
	AfrErrorStatistics,
	AfrSummary,
	CalibrationProvenance,
	NeighborhoodAfrSummary,
	SampleAfrError,
	TargetAfrErrorAnalysis
} from '../../shared/types/targetAfrError';
import { locateTableCoordinates, lookupTargetAfr, validateAnalysisAxes } from './strictTableLookup';

export type AnalysisCalibration<Unit extends 'AFR' | 'VE'> = TunerStudioTableMetadata & {
	sourceId: string;
	xQuantity: 'engineSpeed';
	xUnit: 'rpm';
	yQuantity: 'manifoldPressure';
	yUnit: 'kPa';
	valueUnit: Unit;
};

/** TODO: implement and validate an AFR sensor/transport delay model later.
 * No telemetry alignment or time shifting is performed by this placeholder.
 */
export function afrSensorDelayMsToImplementLater(rpm: number, mapKpa: number): 0 {
	void rpm;
	void mapKpa;
	return 0;
}

const finite = (value: number) => (Number.isFinite(value) ? value : null);
const quantile = (sorted: number[], p: number) => {
	const index = (sorted.length - 1) * p,
		low = Math.floor(index),
		fraction = index - low;
	return sorted[low] * (1 - fraction) + sorted[Math.ceil(index)] * fraction;
};

export function afrErrorStatistics(errors: readonly number[]): AfrErrorStatistics {
	if (errors.some((value) => !Number.isFinite(value)))
		throw new Error('Error statistics require finite observations.');
	if (!errors.length)
		return {
			count: 0,
			mean: null,
			median: null,
			populationStdDev: null,
			q25: null,
			q75: null,
			iqr: null,
			mad: null,
			min: null,
			max: null
		};
	const sorted = [...errors].sort((a, b) => a - b);
	const scale = Math.max(Math.abs(sorted[0]), Math.abs(sorted.at(-1)!)) || 1;
	const scaledMean = errors.reduce((sum, value) => sum + value / scale / errors.length, 0);
	const mean = scaledMean * scale;
	const populationStdDev =
		Math.sqrt(
			errors.reduce((sum, value) => sum + (value / scale - scaledMean) ** 2 / errors.length, 0)
		) * scale;
	const median = quantile(sorted, 0.5),
		q25 = quantile(sorted, 0.25),
		q75 = quantile(sorted, 0.75);
	// Scale before subtracting to avoid overflowing intermediate deviations.
	const deviations = errors
		.map((value) => Math.abs(value / scale - median / scale))
		.sort((a, b) => a - b);
	return {
		count: errors.length,
		mean: finite(mean),
		median,
		populationStdDev: finite(populationStdDev),
		q25,
		q75,
		iqr: finite(q75 - q25),
		mad: finite(quantile(deviations, 0.5) * scale),
		min: sorted[0],
		max: sorted.at(-1)!
	};
}

function summarize(rows: readonly SampleAfrError[]): AfrSummary {
	const contributors = rows.filter((row) => row.contributesToAggregate);
	const error = afrErrorStatistics(contributors.map((row) => row.errorAfr!));
	const counts: AfrSummary['counts'] = {
		considered: rows.length,
		eligible: 0,
		excluded: 0,
		validError: 0,
		eligibleValidError: 0,
		grouped: contributors.length,
		targetStatusCounts: {},
		veLocationStatusCounts: {},
		errorStatusCounts: {
			available: 0,
			'invalid-measured-afr': 0,
			'target-unavailable': 0,
			'nonfinite-error': 0
		}
	};
	for (const row of rows) {
		const eligible = row.eligibilityStatus === 'eligible';
		counts[eligible ? 'eligible' : 'excluded']++;
		if (row.errorAfr !== null) {
			counts.validError++;
			if (eligible) counts.eligibleValidError++;
		}
		const targetStatus = row.target.status === 'ok' ? row.target.valueStatus : row.target.status;
		counts.targetStatusCounts[targetStatus] = (counts.targetStatusCounts[targetStatus] ?? 0) + 1;
		counts.veLocationStatusCounts[row.veLocation.status] =
			(counts.veLocationStatusCounts[row.veLocation.status] ?? 0) + 1;
		counts.errorStatusCounts[row.errorStatus]++;
	}
	const nearest = (value: number | null) =>
		value === null
			? null
			: (contributors.reduce<SampleAfrError | null>((best, row) => {
					if (!best) return row;
					const distance = Math.abs(row.errorAfr! - value),
						previous = Math.abs(best.errorAfr! - value);
					return distance < previous || (distance === previous && row.rowIndex < best.rowIndex)
						? row
						: best;
				}, null)?.rowIndex ?? null);
	const ratio = (numerator: number, denominator: number) =>
		denominator ? numerator / denominator : null;
	return {
		counts,
		coverage: {
			eligibleFractionOfConsidered: ratio(counts.eligible, counts.considered),
			validErrorFractionOfEligible: ratio(counts.eligibleValidError, counts.eligible),
			groupedFractionOfEligible: ratio(counts.grouped, counts.eligible)
		},
		error,
		supportingRows: {
			minimumErrorRow: nearest(error.min),
			maximumErrorRow: nearest(error.max),
			nearestMedianRow: nearest(error.median)
		}
	};
}

function provenance(
	table: AnalysisCalibration<'AFR' | 'VE'>,
	unit: 'AFR' | 'VE'
): CalibrationProvenance {
	if (
		!table.sourceId?.trim() ||
		table.xQuantity !== 'engineSpeed' ||
		table.xUnit !== 'rpm' ||
		table.yQuantity !== 'manifoldPressure' ||
		table.yUnit !== 'kPa' ||
		table.valueUnit !== unit
	)
		throw new Error(
			'Calibration requires a source identifier and explicit RPM/MAP-kPa/value semantics.'
		);
	const rpmAxis = table.table.xBreakpoints,
		mapAxisKpa = table.table.yBreakpoints;
	validateAnalysisAxes(rpmAxis, mapAxisKpa);
	return {
		sourceId: table.sourceId,
		xAxisName: table.xAxisName,
		yAxisName: table.yAxisName,
		rpmAxis,
		mapAxisKpa,
		xQuantity: table.xQuantity,
		xUnit: table.xUnit,
		yQuantity: table.yQuantity,
		yUnit: table.yUnit,
		valueUnit: unit
	};
}

/** Diagnostic error for every selected row; aggregates only eligible rows with
 * a valid target and an in-bounds VE neighborhood. Never derives VE corrections.
 */
export function analyzeTargetAfrError(input: {
	session: LogSession;
	targetAfrTable: AnalysisCalibration<'AFR'>;
	veTable: AnalysisCalibration<'VE'>;
	eligibility: AfrEligibility;
}): TargetAfrErrorAnalysis {
	const { session, targetAfrTable, veTable, eligibility } = input;
	const target = provenance(targetAfrTable, 'AFR'),
		ve = provenance(veTable, 'VE');
	if (
		!['steady-afr-ve-v1', 'steady-afr-ve-v2-experimental'].includes(eligibility.classifierVersion)
	)
		throw new Error('Unsupported classifier version');
	const partition =
		eligibility.classifierVersion === 'steady-afr-ve-v1'
			? { startRow: 0, endRowExclusive: session.rowCount }
			: eligibility.partition;
	if (
		!Number.isSafeInteger(partition.startRow) ||
		!Number.isSafeInteger(partition.endRowExclusive) ||
		partition.startRow < 0 ||
		partition.endRowExclusive > session.rowCount ||
		partition.endRowExclusive < partition.startRow ||
		eligibility.samples.length !== partition.endRowExclusive - partition.startRow
	)
		throw new Error('Eligibility partition does not align with session');
	const time = session.channelByIndex(session.timeChannelIndex ?? -1);
	const validTime =
		time &&
		!time.isBoolean &&
		!time.isTimestamp &&
		['s', 'sec', 'seconds'].includes(time.unit.trim().toLowerCase());
	const resolutions = (['rpm', 'load', 'afr'] as const).map((slot) =>
		session.channelMapping.resolve(slot, session)
	);
	const normalized = resolutions.map((resolution) => {
		const channel =
			resolution.status === 'resolved' ? session.findChannel(resolution.channelName) : null;
		return (row: number) =>
			channel && resolution.status === 'resolved' && Number.isFinite(channel.values[row])
				? finite(channel.values[row] * resolution.scale + resolution.offset)
				: null;
	});
	const samples: SampleAfrError[] = eligibility.samples.map((eligible, index) => {
		const row = eligible.rowIndex;
		const timeSec = validTime ? finite(time.values[row]) : null;
		if (row !== partition.startRow + index || eligible.timeSec !== timeSec)
			throw new Error('Eligibility rows/timestamps do not align with session');
		const rpm = normalized[0](row),
			mapKpa = normalized[1](row),
			measuredAfr = normalized[2](row);
		const lookup = lookupTargetAfr(targetAfrTable.table, rpm ?? NaN, mapKpa ?? NaN);
		const veLocation = locateTableCoordinates(ve.rpmAxis, ve.mapAxisKpa, rpm ?? NaN, mapKpa ?? NaN);
		const errorStatus: SampleAfrError['errorStatus'] =
			measuredAfr === null || measuredAfr <= 0
				? 'invalid-measured-afr'
				: lookup.value === null
					? 'target-unavailable'
					: Number.isFinite(measuredAfr - lookup.value)
						? 'available'
						: 'nonfinite-error';
		const errorAfr = errorStatus === 'available' ? measuredAfr! - lookup.value! : null;
		const reasons =
			eligibility.classifierVersion === 'steady-afr-ve-v1'
				? eligibility.samples[index].reasons
				: [...eligibility.samples[index].baseReasons, ...eligibility.samples[index].reasons];
		return {
			rowIndex: row,
			timeSec,
			rpm,
			mapKpa,
			measuredAfr,
			eligibilityStatus: eligible.status,
			eligibilityReasonCodes: [...new Set(reasons.map((reason) => reason.code))],
			target: lookup,
			veLocation,
			errorStatus,
			errorAfr,
			contributesToAggregate:
				eligible.status === 'eligible' && errorAfr !== null && veLocation.status === 'ok',
			delayMs: afrSensorDelayMsToImplementLater(rpm ?? NaN, mapKpa ?? NaN)
		};
	});
	const grouped = new Map<string, SampleAfrError[]>();
	for (const sample of samples) {
		if (sample.veLocation.status !== 'ok') continue;
		const { rpmIndex, mapIndex } = sample.veLocation.neighborhood;
		const key = `${rpmIndex},${mapIndex}`;
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key)!.push(sample);
	}
	const neighborhoods: NeighborhoodAfrSummary[] = [];
	for (let y = 0; y < ve.mapAxisKpa.length - 1; y++)
		for (let x = 0; x < ve.rpmAxis.length - 1; x++) {
			neighborhoods.push({
				rpmIndex: x,
				mapIndex: y,
				rpmBounds: [ve.rpmAxis[x], ve.rpmAxis[x + 1]],
				mapBoundsKpa: [ve.mapAxisKpa[y], ve.mapAxisKpa[y + 1]],
				...summarize(grouped.get(`${x},${y}`) ?? [])
			});
		}
	const occupiedNeighborhoods = neighborhoods.filter((n) => n.error.count > 0).length;
	return {
		analysisVersion: 'target-afr-error-v1',
		classifierVersion: eligibility.classifierVersion,
		eligibilityConfig: { ...eligibility.config },
		baseEligibilityConfig:
			eligibility.classifierVersion === 'steady-afr-ve-v2-experimental'
				? { ...eligibility.baseConfig }
				: null,
		partition: { ...partition },
		tables: { targetAfr: target, ve },
		resolutions,
		delay: { status: 'unimplemented-zero-placeholder', appliedMs: 0 },
		samples,
		summary: summarize(samples),
		neighborhoods,
		gridCoverage: {
			occupiedNeighborhoods,
			totalNeighborhoods: neighborhoods.length,
			fraction: occupiedNeighborhoods / neighborhoods.length
		},
		limitations: [
			'Errors are measured AFR minus interpolated calibration target; they are not VE corrections or predicted improvements.',
			'Calibration semantics must be explicitly bound by the caller; imported axis names alone do not prove MAP kPa or AFR units.',
			'Only eligible rows with valid targets and in-bounds VE neighborhoods contribute. Diagnostic errors on other rows are not aggregate evidence.',
			'AFR sensor/transport delay is unimplemented and fixed at zero; no telemetry is time shifted.',
			'Statistics use equal sample weights, type-7 quantiles, population standard deviation and unscaled MAD. Samples/windows may be correlated; counts are not independent observations.',
			'Empty statistics and unrepresentable numerical results are null. Coverage has explicit sample/grid denominators and is not a confidence estimate.',
			'VE values are not interpolated or required for geometric neighborhood membership; missing target corners with positive weight block target lookup.',
			'Eligibility indices, partitions and timestamps are validated. Existing classifier contracts lack session identity, so callers must supply results from the same unchanged session.'
		]
	};
}
