import { readFileSync } from 'node:fs';
import { realLogBytes } from './realLogFixtures';
import { describe, expect, it } from 'vitest';
import { Table2D } from '../src/lib/server/core/Table2D';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';
import { interpolateVe } from '../src/lib/server/analysis/veInterpolation';
import {
	prepareVeEvaluationDataset,
	type VeEligibilityProfile
} from '../src/lib/server/analysis/prepareVeEvaluation';
import {
	createManualVeCandidate,
	evaluateVeCorrectionCandidate
} from '../src/lib/server/analysis/predictVeCandidate';
import { classifySampleEligibility } from '../src/lib/server/analysis/sampleEligibility';
import { classifyExperimentalEligibility } from '../src/lib/server/analysis/sampleEligibilityV2';
import { importTunerStudioXml } from '../src/lib/server/msl/importTunerStudioXml';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';
import type { AnalysisCalibration } from '../src/lib/server/analysis/targetAfrError';
import type { VeEvaluationDataset } from '../src/lib/shared/types/veEvaluation';

function bind<U extends 'AFR' | 'VE'>(value: Table2D, valueUnit: U): AnalysisCalibration<U> {
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
function fixture(
	edit: (cells: string[], row: number) => void = () => {},
	episodes = 5,
	points = 71
) {
	const lines = Array.from({ length: episodes * points }, (_, row) => {
		const episode = Math.floor(row / points),
			index = row % points;
		const cells = [
			String(episode * 20 + index / 10),
			'1500',
			'60',
			'14.28',
			'185',
			'100',
			'10',
			'0',
			'0',
			'3',
			'Inactive',
			'Inactive'
		];
		edit(cells, row);
		return cells.join('\t');
	});
	const parsed = parseMslWithEligibilityEvidence(
		'Time\tRPM\tMAP\tAFR\tCLT\tFuel: Warmup cor\tTPS\tTPSdot\tMAPdot\tPW\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\ns\trpm\tkPa\tAFR\t°F\t%\t%\t%/s\tkPa/s\tms\t\t\n' +
			lines.join('\n')
	);
	return {
		...parsed,
		targetAfrTable: bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000],
				yBreakpoints: [40, 80],
				values: [
					[14, 14],
					[14, 14]
				]
			}),
			'AFR'
		),
		veTable: bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000],
				yBreakpoints: [40, 80],
				values: [
					[40, 80],
					[120, 160]
				]
			}),
			'VE'
		),
		eligibilityProfile: { version: 'steady-afr-ve-v1' } as VeEligibilityProfile
	};
}
const allChanges = (dataset: VeEvaluationDataset, percent: number) =>
	dataset.cells
		.filter((c) => c.status === 'supported')
		.map((c) => ({ rpmIndex: c.rpmIndex, mapIndex: c.mapIndex, percent }));

describe('strict VE interpolation and influence', () => {
	it('calculates bilinear VE and relative cell influence separately', () => {
		const result = interpolateVe(
			[1000, 2000],
			[40, 80],
			[
				[40, 80],
				[120, 160]
			],
			1500,
			60
		);
		expect(result.value).toBe(100);
		expect(result.corners.map((c) => c.bilinearWeight)).toEqual([0.25, 0.25, 0.25, 0.25]);
		expect(result.corners.map((c) => c.relativeInfluence)).toEqual([0.1, 0.2, 0.3, 0.4]);
		const irregular = interpolateVe(
			[1000, 1500, 3000],
			[30, 50, 100],
			[
				[40, 80, 100],
				[120, 160, 200],
				[220, 240, 260]
			],
			2250,
			75
		);
		expect(irregular.value).toBe(215);
		expect(irregular.corners.map((c) => c.bilinearWeight)).toEqual([0.25, 0.25, 0.25, 0.25]);
	});
	it.each([
		[1000, 40, 40],
		[2000, 40, 80],
		[1000, 80, 120],
		[2000, 80, 160],
		[1000, 60, 80]
	])('accepts the exact boundary %s,%s', (rpm, map, value) => {
		expect(
			interpolateVe(
				[1000, 2000],
				[40, 80],
				[
					[40, 80],
					[120, 160]
				],
				rpm,
				map
			).value
		).toBe(value);
	});
	it('preserves out-of-bounds, missing, and invalid cells without clamping', () => {
		const axes = [1000, 2000],
			map = [40, 80];
		expect(
			interpolateVe(
				axes,
				map,
				[
					[40, null],
					[null, null]
				],
				1000,
				40
			).value
		).toBe(40);
		expect(
			interpolateVe(
				axes,
				map,
				[
					[40, null],
					[120, 160]
				],
				1500,
				60
			).status
		).toBe('missing-ve');
		expect(
			interpolateVe(
				axes,
				map,
				[
					[40, 0],
					[120, 160]
				],
				1500,
				60
			).status
		).toBe('invalid-ve');
		expect(
			interpolateVe(
				axes,
				map,
				[
					[40, 80],
					[120, 160]
				],
				999,
				60
			)
		).toMatchObject({
			status: 'coordinates-unavailable',
			location: { status: 'out-of-bounds' },
			value: null
		});
		expect(
			interpolateVe(
				axes,
				map,
				[
					[40, 80],
					[120, 160]
				],
				NaN,
				60
			).location.status
		).toBe('missing-input');
		expect(() => interpolateVe(axes, map, [[40]], 1500, 60)).toThrow(/dimensions/);
	});
});

describe('immutable episode-based VE preparation', () => {
	it('uses defaults and training-only evidence, preserving classifier results', () => {
		const input = fixture();
		const before = JSON.stringify(classifySampleEligibility(input.session));
		const dataset = prepareVeEvaluationDataset(input);
		expect(dataset.split.status).toBe('ready');
		expect(dataset.episodes).toHaveLength(5);
		expect(dataset.episodes.map((e) => e.partition)).toEqual([
			'training',
			'training',
			'training',
			'holdout',
			'holdout'
		]);
		expect(dataset.split.actualGapSec).toBeGreaterThanOrEqual(10);
		expect(dataset.cells.every((c) => c.status === 'supported')).toBe(true);
		expect(dataset.cells.every((c) => c.qualifyingEpisodeIds.length === 3)).toBe(true);
		expect(JSON.stringify(classifySampleEligibility(input.session))).toBe(before);
		for (const row of dataset.rows.filter((r) => r.status === 'ready')) {
			const range = row.partition === 'training' ? dataset.split.training! : dataset.split.holdout!;
			expect(row.supportRows!.startRow).toBeGreaterThanOrEqual(range.startRow);
			expect(row.supportRows!.endRow).toBeLessThan(range.endRowExclusive);
		}
		expect(dataset.coverage.exclusionCounts.PARTITION_SUPPORT_LEAKAGE).toBeGreaterThan(0);
	});
	it('deep-freezes detached data and binds candidates to dataset content', () => {
		const input = fixture(),
			dataset = prepareVeEvaluationDataset(input);
		expect(() =>
			prepareVeEvaluationDataset({ ...input, categorical: fixture().categorical })
		).toThrow(/prepared session/);
		const copy = prepareVeEvaluationDataset(input);
		expect(copy).toEqual(dataset);
		expect(Object.isFrozen(dataset.rows[0].ve.corners)).toBe(true);
		expect(() => {
			(dataset.tables.ve.values as number[][])[0][0] = 99;
		}).toThrow();
		input.veTable.table.setValue(0, 0, 99);
		expect(dataset.tables.ve.values[0][0]).toBe(40);
		const candidate = createManualVeCandidate(dataset, []);
		expect(() =>
			evaluateVeCorrectionCandidate(prepareVeEvaluationDataset(input), candidate)
		).toThrow(/fingerprint/);
		const corrupted = JSON.parse(JSON.stringify(dataset));
		corrupted.rows[0].afr.measuredAfr = 90;
		expect(() => createManualVeCandidate(corrupted, [])).toThrow(/fingerprint/);
		expect(
			evaluateVeCorrectionCandidate(
				JSON.parse(JSON.stringify(dataset)),
				JSON.parse(JSON.stringify(candidate))
			).paired.status
		).toBe('complete');
	});
	it('does not split a long correlated accepted run to force a holdout', () => {
		const dataset = prepareVeEvaluationDataset(fixture(undefined, 1, 500));
		expect(dataset.episodes).toHaveLength(1);
		expect(dataset.split.status).toBe('insufficient-separated-episodes');
		expect(dataset.cells.every((c) => c.status === 'unsupported')).toBe(true);
		expect(
			evaluateVeCorrectionCandidate(dataset, createManualVeCandidate(dataset, [])).paired.status
		).toBe('empty');
	});
	it('purges complete intermediate episodes when the embargo requires it', () => {
		const dataset = prepareVeEvaluationDataset({ ...fixture(), config: { embargoSec: 35 } });
		expect(dataset.split.actualGapSec).toBeGreaterThanOrEqual(35);
		expect(dataset.episodes.some((e) => e.partition === 'embargo')).toBe(true);
		expect(
			dataset.rows.filter((r) => r.partition === 'embargo').every((r) => r.status === 'excluded')
		).toBe(true);
	});
	it('keeps materially different holdout AFR out of training support decisions', () => {
		const a = prepareVeEvaluationDataset(fixture());
		const b = prepareVeEvaluationDataset(
			fixture((cells, row) => {
				if (row >= 3 * 71) cells[3] = '19';
			})
		);
		expect(a.cells).toEqual(b.cells);
		expect(a.split).toEqual(b.split);
	});
	it('recomputes V2 within each partition without altering its defaults or outputs', () => {
		const input = fixture();
		input.eligibilityProfile = { version: 'steady-afr-ve-v2-experimental' };
		const before = JSON.stringify(
			classifyExperimentalEligibility(input.session, { categorical: input.categorical })
		);
		const dataset = prepareVeEvaluationDataset(input);
		expect(dataset.coverage.holdoutRows).toBeGreaterThan(0);
		for (const row of dataset.rows.filter((r) => r.status === 'ready')) {
			const range = row.partition === 'training' ? dataset.split.training! : dataset.split.holdout!;
			expect(row.supportRows!.startRow).toBeGreaterThanOrEqual(range.startRow);
			expect(row.supportRows!.endRow).toBeLessThan(range.endRowExclusive);
		}
		expect(
			JSON.stringify(
				classifyExperimentalEligibility(input.session, { categorical: input.categorical })
			)
		).toBe(before);
	});
	it('does not group across known stitches, reversals or invalid timestamps', () => {
		const input = fixture((cells, row) => {
			if (row === 20) cells[0] = '';
			if (row === 40) cells[0] = '2';
		});
		input.session.discontinuities.push({ rowIndex: 60, cause: 'StitchPoint' } as never);
		const dataset = prepareVeEvaluationDataset(input);
		for (const boundary of [20, 40, 60])
			expect(dataset.episodes.some((e) => e.startRow < boundary && e.endRow >= boundary)).toBe(
				false
			);
	});
	it('preserves missing VE cells and rejects corrections unsupported by training', () => {
		const input = fixture();
		input.veTable.table.setValue(0, 0, NaN);
		const dataset = prepareVeEvaluationDataset(input);
		expect(dataset.rows.some((r) => r.reasons.includes('VE_MISSING_VE'))).toBe(true);
		const zero = createManualVeCandidate(dataset, []);
		expect(zero.values[0][0]).toBeNull();
		expect(() =>
			createManualVeCandidate(dataset, [{ rpmIndex: 0, mapIndex: 0, percent: 1 }])
		).toThrow(/Unsupported/);
	});
	it.each([
		{ maxCorrectionPct: 100 },
		{ trainingFraction: 1 },
		{ minTrainingEpisodesPerCell: 0 },
		{ minRelativeInfluence: 0 },
		{ maxObservationGapSec: 0 },
		{ typo: 1 }
	])('rejects invalid preparation config %j', (config) => {
		expect(() => prepareVeEvaluationDataset({ ...fixture(), config })).toThrow();
	});
});

describe('manual VE vector prediction and paired baseline', () => {
	it('exactly reproduces the unchanged baseline for a zero vector', () => {
		const dataset = prepareVeEvaluationDataset(fixture()),
			candidate = createManualVeCandidate(dataset, []);
		const result = evaluateVeCorrectionCandidate(dataset, candidate);
		expect(result.paired.candidate).toEqual(result.paired.baseline);
		expect(result.paired.predictedDeltaMae).toBe(0);
		expect(result.rows.every((r) => r.predictedAfr === r.baselineAfr)).toBe(true);
		expect(result.paired.rowCount).toBe(dataset.coverage.holdoutRows);
		expect(candidate.values).toEqual(dataset.tables.ve.values);
	});
	it('predicts a uniform 2% VE increase with AFR divided by 1.02', () => {
		const dataset = prepareVeEvaluationDataset(fixture());
		const result = evaluateVeCorrectionCandidate(
			dataset,
			createManualVeCandidate(dataset, allChanges(dataset, 2))
		);
		expect(result.rows[0].candidateVe).toBeCloseTo(102);
		expect(result.rows[0].predictedAfr).toBeCloseTo(14);
		expect(result.paired.baseline.mae).toBeCloseTo(0.28);
		expect(result.paired.candidate!.mae).toBeCloseTo(0);
		expect(result.paired.predictedDeltaMae).toBeCloseTo(-0.28);
		expect(result.byEpisode.reduce((sum, e) => sum + e.paired.rowCount, 0)).toBe(
			result.rows.length
		);
	});
	it('accounts for original VE influence rather than applying a cell percentage to the whole row', () => {
		const dataset = prepareVeEvaluationDataset(fixture());
		const candidate = createManualVeCandidate(dataset, [{ rpmIndex: 1, mapIndex: 0, percent: 2 }]);
		const result = evaluateVeCorrectionCandidate(dataset, candidate);
		expect(result.rows[0].candidateVe).toBeCloseTo(100.4);
		expect(result.rows[0].predictedAfr).toBeCloseTo(14.28 / 1.004);
		expect(result.paired.rowCount).toBe(dataset.coverage.holdoutRows);
	});
	it('keeps worse predictions and unchanged observations in paired metrics', () => {
		const dataset = prepareVeEvaluationDataset(fixture());
		const result = evaluateVeCorrectionCandidate(
			dataset,
			createManualVeCandidate(dataset, allChanges(dataset, -3))
		);
		expect(result.paired.predictedDeltaMae!).toBeGreaterThan(0);
		expect(result.rows).toHaveLength(dataset.coverage.holdoutRows);
		expect(result.paired.baseline.count).toBe(result.paired.candidate!.count);
	});
	it.each([3.001, -3.001, NaN, Infinity])(
		'rejects unbounded/nonfinite manual correction %s',
		(percent) => {
			const dataset = prepareVeEvaluationDataset(fixture());
			expect(() =>
				createManualVeCandidate(dataset, [{ rpmIndex: 0, mapIndex: 0, percent }])
			).toThrow();
		}
	);
	it('rejects duplicate/index mistakes and tampered candidate contents', () => {
		const dataset = prepareVeEvaluationDataset(fixture());
		const change = { rpmIndex: 0, mapIndex: 0, percent: 1 };
		expect(() => createManualVeCandidate(dataset, [change, change])).toThrow(/Duplicate/);
		expect(() => createManualVeCandidate(dataset, [{ ...change, rpmIndex: 99 }])).toThrow();
		const candidate = createManualVeCandidate(dataset, [change]);
		const corrupted = JSON.parse(JSON.stringify(candidate));
		corrupted.values[0][0] = 90;
		expect(() => evaluateVeCorrectionCandidate(dataset, corrupted)).toThrow(/fingerprint/);
		expect(() => {
			(candidate.values as number[][])[0][0] = 90;
		}).toThrow();
	});
	it('records unobserved neighboring effects of a shared cell', () => {
		const input = fixture();
		input.veTable = bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000, 3000],
				yBreakpoints: [40, 80],
				values: [
					[40, 80, 120],
					[120, 160, 200]
				]
			}),
			'VE'
		);
		const dataset = prepareVeEvaluationDataset(input);
		const result = evaluateVeCorrectionCandidate(
			dataset,
			createManualVeCandidate(dataset, [{ rpmIndex: 1, mapIndex: 0, percent: 2 }])
		);
		expect(result.changedNeighborhoods).toEqual([
			{
				rpmIndex: 0,
				mapIndex: 0,
				evaluationRows: dataset.coverage.holdoutRows,
				status: 'observed'
			},
			{ rpmIndex: 1, mapIndex: 0, evaluationRows: 0, status: 'unassessed' }
		]);
	});
	it('predicts a shared cell change in both adjacent neighborhoods', () => {
		const input = fixture((cells, row) => {
			if (row % 71 >= 35) cells[1] = '2500';
		});
		input.veTable = bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000, 3000],
				yBreakpoints: [40, 80],
				values: [
					[40, 80, 120],
					[120, 160, 200]
				]
			}),
			'VE'
		);
		input.targetAfrTable = bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000, 3000],
				yBreakpoints: [40, 80],
				values: [
					[14, 14, 14],
					[14, 14, 14]
				]
			}),
			'AFR'
		);
		const dataset = prepareVeEvaluationDataset(input);
		const result = evaluateVeCorrectionCandidate(
			dataset,
			createManualVeCandidate(dataset, [{ rpmIndex: 1, mapIndex: 0, percent: 2 }])
		);
		const left = result.rows.find((r) => r.rpmIndex === 0)!,
			right = result.rows.find((r) => r.rpmIndex === 1)!;
		expect(left.candidateVe).toBeCloseTo(100.4);
		expect(right.candidateVe).toBeCloseTo(140.4);
		expect(right.predictedAfr).toBeCloseTo((14.28 * 140) / 140.4);
	});
	it('round-trips arbitrary decimal manual percentages without changing the vector', () => {
		const dataset = prepareVeEvaluationDataset(fixture());
		for (const percent of [0.29, 1.23456789, 2.71, -0.57, 3, -3]) {
			const candidate = createManualVeCandidate(dataset, [{ rpmIndex: 0, mapIndex: 0, percent }]);
			expect(candidate.changedCells[0].percent).toBe(percent);
			expect(evaluateVeCorrectionCandidate(dataset, candidate).paired.status).toBe('complete');
		}
	});
	it('keeps failed prediction rows and marks candidate paired metrics unavailable', () => {
		const dataset = prepareVeEvaluationDataset(
			fixture((cells, row) => {
				if (row >= 4 * 71) cells[3] = '1.75e308';
			})
		);
		const result = evaluateVeCorrectionCandidate(
			dataset,
			createManualVeCandidate(dataset, allChanges(dataset, -3))
		);
		expect(result.rows).toHaveLength(dataset.coverage.holdoutRows);
		expect(result.rows.some((r) => r.status === 'predicted')).toBe(true);
		expect(result.paired.failedPredictions).toBeGreaterThan(0);
		expect(result.paired.status).toBe('prediction-failure');
		expect(result.paired.candidate).toBeNull();
		expect(result.paired.baseline.count).toBe(dataset.coverage.holdoutRows);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
	it('does not qualify holdout-only cells and retains unaffected rows in the same comparison', () => {
		const input = fixture((cells, row) => {
			if (row >= 4 * 71) cells[1] = '2500';
		});
		input.veTable = bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000, 3000],
				yBreakpoints: [40, 80],
				values: [
					[40, 80, 120],
					[120, 160, 200]
				]
			}),
			'VE'
		);
		input.targetAfrTable = bind(
			Table2D.fromJSON({
				xBreakpoints: [1000, 2000, 3000],
				yBreakpoints: [40, 80],
				values: [
					[14, 14, 14],
					[14, 14, 14]
				]
			}),
			'AFR'
		);
		const dataset = prepareVeEvaluationDataset(input);
		const holdoutOnly = dataset.cells.find((c) => c.rpmIndex === 2 && c.mapIndex === 0)!;
		expect(holdoutOnly.materialTrainingSamples).toBe(0);
		expect(holdoutOnly.status).toBe('unsupported');
		expect(() =>
			createManualVeCandidate(dataset, [{ rpmIndex: 2, mapIndex: 0, percent: 1 }])
		).toThrow(/Unsupported/);
		const candidate = createManualVeCandidate(dataset, [{ rpmIndex: 0, mapIndex: 0, percent: 1 }]);
		const result = evaluateVeCorrectionCandidate(dataset, candidate);
		expect(candidate.values[0][2]).toBe(dataset.tables.ve.values[0][2]);
		expect(result.rows.some((r) => !r.affected)).toBe(true);
		expect(result.rows.some((r) => r.affected)).toBe(true);
		expect(result.affectedOnly.rowCount).toBeLessThan(result.paired.rowCount);
		expect(result.paired.rowCount).toBe(dataset.coverage.holdoutRows);
	});
});

it('prepares representative real telemetry with associated calibration without forcing cell support', () => {
	const { session, categorical } = parseMslWithEligibilityEvidence(
		decodeMsl(realLogBytes('2025-04-12_16.16.28.msl')).content
	);
	const afr = importTunerStudioXml(readFileSync('tests/fixtures/xml/afr.table', 'utf8'));
	const ve = importTunerStudioXml(readFileSync('tests/fixtures/xml/ve.table', 'utf8'));
	const dataset = prepareVeEvaluationDataset({
		session,
		categorical,
		targetAfrTable: { ...bind(afr.table, 'AFR'), ...afr },
		veTable: { ...bind(ve.table, 'VE'), ...ve },
		eligibilityProfile: { version: 'steady-afr-ve-v1' }
	});
	const result = evaluateVeCorrectionCandidate(dataset, createManualVeCandidate(dataset, []));
	expect(dataset.rows).toHaveLength(2859);
	expect(dataset.cells.every((c) => c.status === 'unsupported')).toBe(true);
	expect(result.paired.predictedDeltaMae === 0 || result.paired.status === 'empty').toBe(true);
	expect(dataset.limitations.some((s) => s.includes('unimplemented AFR delay'))).toBe(true);
}, 20000);
