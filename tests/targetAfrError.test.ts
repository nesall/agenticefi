import { readFileSync } from 'node:fs';
import { realLogBytes } from './realLogFixtures';
import { describe, expect, it } from 'vitest';
import { Table2D } from '../src/lib/server/core/Table2D';
import { classifySampleEligibility } from '../src/lib/server/analysis/sampleEligibility';
import { classifyExperimentalEligibility } from '../src/lib/server/analysis/sampleEligibilityV2';
import {
	lookupTargetAfr,
	locateTableCoordinates
} from '../src/lib/server/analysis/strictTableLookup';
import {
	analyzeTargetAfrError,
	afrErrorStatistics,
	afrSensorDelayMsToImplementLater,
	type AnalysisCalibration
} from '../src/lib/server/analysis/targetAfrError';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';
import { importTunerStudioXml } from '../src/lib/server/msl/importTunerStudioXml';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';

function table(
	x = [1000, 2000],
	y = [40, 80],
	values = [
		[10, 12],
		[14, 16]
	]
) {
	return Table2D.fromJSON({ xBreakpoints: x, yBreakpoints: y, values });
}
function bound<U extends 'AFR' | 'VE'>(value: Table2D, valueUnit: U): AnalysisCalibration<U> {
	return {
		table: value,
		sourceId: `test-${valueUnit}`,
		xAxisName: 'rpm',
		yAxisName: 'load',
		xQuantity: 'engineSpeed',
		xUnit: 'rpm',
		yQuantity: 'manifoldPressure',
		yUnit: 'kPa',
		valueUnit
	};
}
function log(edit: (cells: string[], row: number) => void = () => {}, n = 31) {
	const rows = Array.from({ length: n }, (_, i) => {
		const cells = [
			String(i / 10),
			'1500',
			'60',
			'14',
			'185',
			'100',
			'10',
			'0',
			'0',
			'3',
			'Inactive',
			'Inactive'
		];
		edit(cells, i);
		return cells.join('\t');
	});
	return parseMslWithEligibilityEvidence(
		'Time\tRPM\tMAP\tAFR\tCLT\tFuel: Warmup cor\tTPS\tTPSdot\tMAPdot\tPW\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\ns\trpm\tkPa\tAFR\t°F\t%\t%\t%/s\tkPa/s\tms\t\t\n' +
			rows.join('\n')
	);
}
function analyze(
	input = log(),
	overrides: Partial<Parameters<typeof analyzeTargetAfrError>[0]> = {}
) {
	return analyzeTargetAfrError({
		session: input.session,
		targetAfrTable: bound(table(), 'AFR'),
		veTable: bound(table(), 'VE'),
		eligibility: classifySampleEligibility(input.session),
		...overrides
	});
}

describe('strict target AFR interpolation', () => {
	it('interpolates bilinearly on actual unequal axis intervals and records weights', () => {
		const t = table(
			[1000, 1500, 3000],
			[30, 50, 100],
			[
				[10, 12, 18],
				[14, 16, 22],
				[24, 26, 32]
			]
		);
		const result = lookupTargetAfr(t, 2250, 75);
		expect(result.value).toBe(24);
		expect(result.corners.map((c) => c.weight)).toEqual([0.25, 0.25, 0.25, 0.25]);
		expect(result.status === 'ok' && result.neighborhood).toMatchObject({
			rpmIndex: 1,
			mapIndex: 1,
			rpmFraction: 0.5,
			mapFraction: 0.5
		});
	});
	it.each([
		[1000, 40, 10],
		[2000, 40, 12],
		[1000, 80, 14],
		[2000, 80, 16],
		[1500, 40, 11],
		[1000, 60, 12],
		[2000, 60, 14]
	])('accepts exact corners and edges (%s,%s)', (rpm, map, value) => {
		expect(lookupTargetAfr(table(), rpm, map)).toMatchObject({
			status: 'ok',
			valueStatus: 'available',
			value
		});
	});
	it.each([
		[999, 60],
		[2001, 60],
		[1500, 39],
		[1500, 81],
		[999, 81]
	])('preserves out-of-bounds coordinates (%s,%s) without clamping', (rpm, map) => {
		const result = lookupTargetAfr(table(), rpm, map);
		expect(result).toMatchObject({ status: 'out-of-bounds', value: null, rpm, mapKpa: map });
		if (result.status === 'out-of-bounds')
			expect(result.outsideAxes).toHaveLength(rpm === 999 && map === 81 ? 2 : 1);
	});
	it('preserves missing coordinates and ignores missing or invalid zero-weight corners', () => {
		const t = table();
		t.setValue(0, 1, NaN);
		t.setValue(1, 0, 0);
		t.setValue(1, 1, NaN);
		expect(lookupTargetAfr(t, 1000, 40).value).toBe(10);
		expect(lookupTargetAfr(t, 1500, 60).valueStatus).toBe('missing-cells');
		expect(lookupTargetAfr(t, NaN, Infinity)).toMatchObject({
			status: 'missing-input',
			missingAxes: ['rpm', 'mapKpa'],
			rpm: null,
			mapKpa: null
		});
		expect(lookupTargetAfr(t, 1000, 80).valueStatus).toBe('invalid-target-afr');
	});
	it.each([0, -1])('does not interpolate through a nonpositive contributing target %s', (value) => {
		const t = table();
		t.setValue(1, 1, value);
		expect(lookupTargetAfr(t, 1500, 60)).toMatchObject({
			valueStatus: 'invalid-target-afr',
			value: null
		});
	});
	it('assigns internal knots to the upper neighborhood and the maximum to the final one', () => {
		const axis = [1000, 2000, 3000],
			map = [30, 50, 100];
		expect(locateTableCoordinates(axis, map, 2000, 50)).toMatchObject({
			neighborhood: { rpmIndex: 1, mapIndex: 1, rpmFraction: 0, mapFraction: 0 }
		});
		expect(locateTableCoordinates(axis, map, 3000, 100)).toMatchObject({
			neighborhood: { rpmIndex: 1, mapIndex: 1, rpmFraction: 1, mapFraction: 1 }
		});
		expect(() => lookupTargetAfr(new Table2D([1000], [30, 50]), 1000, 40)).toThrow();
	});
	it('keeps fractions finite when finite axis endpoints have an overflowing difference', () => {
		expect(lookupTargetAfr(table([-1e308, 1e308]), 0, 60).value).toBe(13);
	});
});

describe('AFR error statistics and eligibility aggregation', () => {
	it('calculates mean, type-7 quantiles, population deviation and unscaled MAD', () => {
		const result = afrErrorStatistics([-2, 0, 2, 4]);
		expect(result).toMatchObject({
			count: 4,
			mean: 1,
			median: 1,
			q25: -0.5,
			q75: 2.5,
			iqr: 3,
			mad: 2,
			min: -2,
			max: 4
		});
		expect(result.populationStdDev).toBeCloseTo(Math.sqrt(5));
		expect(afrErrorStatistics([3])).toMatchObject({
			mean: 3,
			median: 3,
			populationStdDev: 0,
			mad: 0
		});
		expect(afrErrorStatistics([])).toEqual({
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
		});
		expect(() => afrErrorStatistics([NaN])).toThrow();
	});
	it('does not overflow simple finite extreme means and population deviation', () => {
		expect(afrErrorStatistics([1e308, 1e308]).mean).toBe(1e308);
		expect(afrErrorStatistics([-1e308, 1e308]).populationStdDev).toBe(1e308);
	});
	it('aggregates hand-calculated errors and resolves median-support ties by original row', () => {
		const input = log((cells, row) => {
			cells[3] = String([13, 11, 13, 15, 17][row]);
		}, 5);
		const eligibility = classifySampleEligibility(input.session, { steadyWindowSec: 0 });
		const result = analyze(input, { eligibility });
		expect(result.summary.error).toMatchObject({
			count: 4,
			mean: 1,
			median: 1,
			q25: -0.5,
			q75: 2.5,
			iqr: 3,
			mad: 2
		});
		expect(result.summary.supportingRows).toEqual({
			minimumErrorRow: 1,
			maximumErrorRow: 4,
			nearestMedianRow: 2
		});
		expect(result.summary.coverage).toEqual({
			eligibleFractionOfConsidered: 0.8,
			validErrorFractionOfEligible: 1,
			groupedFractionOfEligible: 1
		});
		expect(result.eligibilityConfig).toEqual(eligibility.config);
	});
	it('retains missing target-cell counts and allows geometric grouping without VE values', () => {
		const missingTarget = table();
		missingTarget.setValue(1, 1, NaN);
		const result = analyze(log(), { targetAfrTable: bound(missingTarget, 'AFR') });
		expect(result.summary.counts.targetStatusCounts['missing-cells']).toBe(31);
		expect(result.summary.counts.grouped).toBe(0);
		const emptyVe = new Table2D([1000, 2000], [40, 80]);
		expect(
			analyze(log(), { veTable: bound(emptyVe, 'VE') }).summary.counts.grouped
		).toBeGreaterThan(0);
	});
	it('returns explicit empty statistics for an empty V2 partition', () => {
		const input = log();
		const eligibility = classifyExperimentalEligibility(input.session, {
			categorical: input.categorical,
			partition: { startRow: 5, endRowExclusive: 5 }
		});
		const result = analyze(input, { eligibility });
		expect(result.samples).toHaveLength(0);
		expect(result.summary.coverage.eligibleFractionOfConsidered).toBeNull();
		expect(result.summary.error.count).toBe(0);
	});
	it('computes signed errors but uses only eligible evidence in aggregates', () => {
		const input = log((cells, row) => {
			cells[3] = String(11 + (row % 4));
		});
		const eligibility = classifySampleEligibility(input.session);
		const before = JSON.stringify({ eligibility, session: input.session });
		const result = analyze(input, { eligibility });
		expect(result.samples[0]).toMatchObject({ errorAfr: -2, contributesToAggregate: false });
		expect(result.samples[0].eligibilityReasonCodes).toContain('RPM_TRANSIENT_UNASSESSED');
		const rows = result.samples.filter((s) => s.contributesToAggregate);
		expect(result.summary.error).toEqual(afrErrorStatistics(rows.map((s) => s.errorAfr!)));
		expect(result.summary.counts.grouped).toBe(eligibility.summary.statuses.eligible);
		expect(result.neighborhoods[0].counts.grouped).toBe(rows.length);
		expect(result.summary.supportingRows.minimumErrorRow).toBe(
			rows.find((s) => s.errorAfr === -2)!.rowIndex
		);
		expect(JSON.stringify({ eligibility, session: input.session })).toBe(before);
		expect(result.delay).toEqual({ status: 'unimplemented-zero-placeholder', appliedMs: 0 });
		expect(afrSensorDelayMsToImplementLater(NaN, Infinity)).toBe(0);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
	it('preserves target-outside, VE-outside and missing measured values independently', () => {
		const input = log((cells, row) => {
			if (row === 25) cells[3] = '';
			if (row === 26) cells[1] = '2500';
		});
		const result = analyze(input, { veTable: bound(table([1000, 1200]), 'VE') });
		expect(result.samples[24]).toMatchObject({
			errorAfr: 1,
			contributesToAggregate: false,
			veLocation: { status: 'out-of-bounds' }
		});
		expect(result.samples[25]).toMatchObject({
			errorStatus: 'invalid-measured-afr',
			errorAfr: null
		});
		expect(result.samples[26]).toMatchObject({
			target: { status: 'out-of-bounds' },
			errorAfr: null
		});
		expect(result.summary.counts.eligibleValidError).toBeGreaterThan(0);
		expect(result.summary.counts.grouped).toBe(0);
		expect(result.summary.error.mean).toBeNull();
	});
	it('includes empty neighborhoods and their null coverage denominators', () => {
		const result = analyze(log(), {
			veTable: bound(
				table(
					[1000, 2000, 3000],
					[40, 80],
					[
						[1, 2, 3],
						[1, 2, 3]
					]
				),
				'VE'
			)
		});
		expect(result.neighborhoods).toHaveLength(2);
		expect(result.neighborhoods[1].counts.considered).toBe(0);
		expect(result.neighborhoods[1].coverage.groupedFractionOfEligible).toBeNull();
		expect(result.gridCoverage).toEqual({
			occupiedNeighborhoods: 1,
			totalNeighborhoods: 2,
			fraction: 0.5
		});
	});
	it('supports an actual V2 partition without recomputing or changing eligibility', () => {
		const input = log();
		const eligibility = classifyExperimentalEligibility(input.session, {
			categorical: input.categorical,
			partition: { startRow: 5, endRowExclusive: 26 }
		});
		const before = JSON.stringify(eligibility);
		const result = analyze(input, { eligibility });
		expect(result.classifierVersion).toBe('steady-afr-ve-v2-experimental');
		expect(result.samples.map((s) => s.rowIndex)).toEqual(
			Array.from({ length: 21 }, (_, i) => i + 5)
		);
		expect(result.summary.counts.grouped).toBe(eligibility.summary.statuses.eligible);
		expect(JSON.stringify(eligibility)).toBe(before);
	});
	it('rejects misaligned eligibility rows, timestamps and unsupported calibration units', () => {
		const input = log(),
			eligibility = classifySampleEligibility(input.session);
		eligibility.samples[20].timeSec = 99;
		expect(() => analyze(input, { eligibility })).toThrow(/align/);
		const wrongRows = classifySampleEligibility(input.session);
		wrongRows.samples[10].rowIndex = 11;
		expect(() => analyze(input, { eligibility: wrongRows })).toThrow(/align/);
		expect(() =>
			analyze(input, { targetAfrTable: { ...bound(table(), 'AFR'), yUnit: 'psi' } as never })
		).toThrow(/semantics/);
	});
	it('treats unresolved/missing channels as unavailable rather than zero', () => {
		const input = log();
		input.session.channelMapping.afr = 'not present';
		input.session.channelMapping.load = 'not present';
		const result = analyze(input);
		expect(result.samples[20]).toMatchObject({
			mapKpa: null,
			measuredAfr: null,
			errorAfr: null,
			target: { status: 'missing-input' }
		});
		expect(result.summary.counts.grouped).toBe(0);
	});
});

describe('imported calibration integration', () => {
	it('uses the distinct real target and VE axes and preserves their different bounds', () => {
		const afr = importTunerStudioXml(readFileSync('tests/fixtures/xml/afr.table', 'utf8'));
		const ve = importTunerStudioXml(readFileSync('tests/fixtures/xml/ve.table', 'utf8'));
		const input = log((cells) => {
			cells[1] = '8500';
			cells[2] = '125';
		});
		const result = analyze(input, {
			targetAfrTable: { ...bound(afr.table, 'AFR'), ...afr },
			veTable: { ...bound(ve.table, 'VE'), ...ve }
		});
		expect(result.samples[20].target.status).toBe('out-of-bounds');
		expect(result.samples[20].veLocation.status).toBe('ok');
		expect(result.tables.targetAfr.rpmAxis.at(-1)).toBe(8000);
		expect(result.tables.ve.rpmAxis.at(-1)).toBe(9000);
		expect(lookupTargetAfr(afr.table, 8000, 125).value).toBeCloseTo(11.2);
	});
	it('analyzes representative real telemetry using the associated block1 calibration', () => {
		const input = parseMslWithEligibilityEvidence(
			decodeMsl(realLogBytes('2025-04-12_16.16.28.msl')).content
		);
		const afr = importTunerStudioXml(readFileSync('tests/fixtures/xml/afr.table', 'utf8'));
		const ve = importTunerStudioXml(readFileSync('tests/fixtures/xml/ve.table', 'utf8'));
		for (const eligibility of [
			classifySampleEligibility(input.session),
			classifyExperimentalEligibility(input.session, { categorical: input.categorical })
		]) {
			const result = analyze(input, {
				eligibility,
				targetAfrTable: { ...bound(afr.table, 'AFR'), ...afr },
				veTable: { ...bound(ve.table, 'VE'), ...ve }
			});
			expect(result.summary.counts.considered).toBe(2859);
			expect(result.summary.counts.grouped).toBeGreaterThan(0);
			expect(result.neighborhoods.reduce((sum, n) => sum + n.error.count, 0)).toBe(
				result.summary.error.count
			);
			for (const sample of result.samples.filter((s) => s.contributesToAggregate)) {
				expect(sample.errorAfr).toBeCloseTo(sample.measuredAfr! - sample.target.value!);
				expect(sample.target.corners.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1);
			}
		}
	}, 20000);
});
