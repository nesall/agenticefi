import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Table2D } from '../src/lib/server/core/Table2D';
import { prepareVeEvaluationDataset } from '../src/lib/server/analysis/prepareVeEvaluation';
import {
	fitVeCorrections,
	fitAndEvaluateVeCorrections,
	veFitConfig
} from '../src/lib/server/analysis/fitVeCorrections';
import {
	episodeBalanced,
	influenceConditioning,
	solveBoundedVe,
	type FitObservation
} from '../src/lib/server/analysis/veFitMath';
import { evaluateVeCorrectionCandidate } from '../src/lib/server/analysis/predictVeCandidate';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';
import { importTunerStudioXml } from '../src/lib/server/msl/importTunerStudioXml';
import type { AnalysisCalibration } from '../src/lib/server/analysis/targetAfrError';
import type { VePreparationConfig } from '../src/lib/shared/types/veEvaluation';

function bind<U extends 'AFR' | 'VE'>(table: Table2D, valueUnit: U): AnalysisCalibration<U> {
	return {
		table,
		sourceId: `synthetic-${valueUnit}`,
		xAxisName: 'rpm',
		yAxisName: 'load',
		xQuantity: 'engineSpeed',
		xUnit: 'rpm',
		yQuantity: 'manifoldPressure',
		yUnit: 'kPa',
		valueUnit
	};
}
function synthetic(
	options: {
		ratio?: (episode: number) => number;
		center?: boolean;
		holdoutAfr?: number;
		coordinates?: (episode: number, index: number) => [number, number];
		preparation?: Partial<VePreparationConfig>;
	} = {}
) {
	const points = 71;
	const text = Array.from({ length: 20 * points }, (_, row) => {
		const episode = Math.floor(row / points),
			cell = episode % 4;
		const [rpm, map] = options.coordinates?.(episode, row % points) ?? [
			options.center ? 1500 : cell % 2 ? 2000 : 1000,
			options.center ? 60 : cell < 2 ? 40 : 80
		];
		const ratio = options.ratio?.(episode) ?? [0.02, -0.015, 0.01, -0.025][cell];
		const afr =
			episode >= 14 && options.holdoutAfr !== undefined ? options.holdoutAfr : 14 * (1 + ratio);
		return [
			episode * 20 + (row % points) / 10,
			rpm,
			map,
			afr,
			185,
			100,
			10,
			0,
			0,
			3,
			'Inactive',
			'Inactive'
		].join('\t');
	}).join('\n');
	const parsed = parseMslWithEligibilityEvidence(
		'Time\tRPM\tMAP\tAFR\tCLT\tFuel: Warmup cor\tTPS\tTPSdot\tMAPdot\tPW\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\ns\trpm\tkPa\tAFR\t°F\t%\t%\t%/s\tkPa/s\tms\t\t\n' +
			text
	);
	return prepareVeEvaluationDataset({
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
					[100, 100],
					[100, 100]
				]
			}),
			'VE'
		),
		eligibilityProfile: { version: 'steady-afr-ve-v1' },
		config: options.preparation
	});
}
const observation = (episodeId: number, b: number, weights = [1]): FitObservation => ({
	rowIndex: 0,
	episodeId,
	b,
	terms: weights.map((a, cellIndex) => ({ cellIndex, a }))
});

describe('episode-balanced bounded Huber/ridge mathematics', () => {
	it('assigns each episode equal total weight, irrespective of row count', () => {
		const weighted = episodeBalanced([
			observation(0, 0),
			...Array.from({ length: 9 }, () => observation(1, 0))
		]);
		expect(weighted[0].weight).toBe(0.5);
		expect(weighted.slice(1).reduce((sum, r) => sum + r.weight, 0)).toBeCloseTo(0.5);
	});
	it('matches the analytic one-cell ridge solution in the quadratic Huber region', () => {
		const config = veFitConfig();
		const result = solveBoundedVe(
			[observation(0, 0.02), observation(1, 0.02), observation(2, 0.02)],
			[0],
			0.03,
			config
		);
		expect(result.diagnostic.status).toBe('converged');
		expect(result.values[0]).toBeCloseTo(0.02 / 1.02, 9);
	});
	it('solves coupled influences jointly rather than independently applying row ratios', () => {
		const config = veFitConfig({ ridgePenalty: 0.001 });
		// A=[[.75,.25],[.25,.75]], q=.5; desired b=[.01,-.01].
		// Antisymmetric eigenvalue of A'WA is .125; ridge Hessian is .001.
		const result = solveBoundedVe(
			[observation(0, 0.01, [0.75, 0.25]), observation(1, -0.01, [0.25, 0.75])],
			[0, 1],
			0.03,
			config
		);
		expect(result.diagnostic.status).toBe('converged');
		expect(result.values[0]).toBeCloseTo(0.0025 / 0.126, 7);
		expect(result.values[1]).toBeCloseTo(-0.0025 / 0.126, 7);
	});
	it('uses bounded optimization and reports an active bound without post-fit clipping', () => {
		const result = solveBoundedVe(
			[observation(0, 0.2), observation(1, 0.2)],
			[0],
			0.03,
			veFitConfig()
		);
		expect(result.diagnostic.status).toBe('converged');
		expect(result.values[0]).toBe(0.03);
		expect(result.diagnostic.projectedGradient).toBe(0);
	});
	it('limits outlier influence with Huber loss', () => {
		const rows = [...Array.from({ length: 99 }, () => observation(0, 0.01)), observation(0, 1)];
		const robust = solveBoundedVe(rows, [0], 0.03, veFitConfig());
		const quadratic = solveBoundedVe(rows, [0], 0.03, veFitConfig({ huberThreshold: 2 }));
		expect(robust.values[0]).toBeLessThan(0.011);
		expect(quadratic.values[0]).toBeGreaterThan(0.019);
	});
	it('does not renormalize shared influence when another cell is frozen', () => {
		const result = solveBoundedVe(
			[observation(0, 0.01, [0.5, 0.5]), observation(1, 0.01, [0.5, 0.5])],
			[0],
			0.03,
			veFitConfig()
		);
		expect(result.diagnostic.status).toBe('converged');
		expect(result.values[0]).toBeCloseTo(0.005 / 0.27, 8);
	});
	it('does not count duplicated samples as extra episode weight', () => {
		const a = solveBoundedVe(
			[observation(0, 0.01), observation(1, 0.03)],
			[0],
			0.03,
			veFitConfig()
		);
		const b = solveBoundedVe(
			[...Array.from({ length: 100 }, () => observation(0, 0.01)), observation(1, 0.03)],
			[0],
			0.03,
			veFitConfig()
		);
		expect(a.values[0]).toBeCloseTo(b.values[0], 9);
	});
	it('detects exact rank deficiency independently of ridge', () => {
		const groups = influenceConditioning(
			[
				observation(0, 0.02, [0.25, 0.25, 0.25, 0.25]),
				observation(1, 0.03, [0.25, 0.25, 0.25, 0.25])
			],
			[0, 1, 2, 3],
			veFitConfig({ ridgePenalty: 100 })
		);
		expect(groups[0]).toMatchObject({
			rank: 1,
			columns: 4,
			status: 'rank-deficient',
			conditionNumber: null
		});
	});
	it('distinguishes full rank but ill-conditioned groups and column scaling', () => {
		const rows = [observation(0, 0, [0.4999, 0.5001]), observation(1, 0, [0.5001, 0.4999])];
		const group = influenceConditioning(rows, [0, 1], veFitConfig())[0];
		expect(group.status).toBe('ill-conditioned');
		expect(group.rank).toBe(2);
		expect(group.conditionNumber!).toBeGreaterThan(1000);
		expect(
			influenceConditioning(
				[observation(0, 0, [1, 0]), observation(1, 0, [0, 0.0001])],
				[0, 1],
				veFitConfig()
			).every((g) => g.status === 'identifiable')
		).toBe(true);
	});
});

describe('training-only fit, suppression, and Phase A prediction', () => {
	it('accepts stable, identifiable proposals and uses the existing holdout predictor', () => {
		const dataset = synthetic(),
			before = JSON.stringify(dataset);
		const result = fitAndEvaluateVeCorrections(dataset);
		expect(fitVeCorrections(dataset)).toEqual(result.fit);
		expect(result.fit.status).toBe('candidate');
		expect(result.fit.cells.every((c) => c.status === 'accepted')).toBe(true);
		for (const cell of result.fit.cells) {
			expect(Math.abs(cell.finalCorrectionPct)).toBeLessThanOrEqual(3);
			expect(cell.stability!.directionStable).toBe(true);
			expect(cell.stability!.foldPercentages).toHaveLength(result.fit.trainingEpisodeIds.length);
		}
		expect(result.evaluation).toEqual(evaluateVeCorrectionCandidate(dataset, result.fit.candidate));
		expect(result.evaluation.paired.rowCount).toBe(dataset.coverage.holdoutRows);
		expect(JSON.stringify(dataset)).toBe(before);
		expect(Object.isFrozen(result.fit.cells[0].stability)).toBe(true);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
	it('suppresses an unidentifiable shared-cell group instead of using ridge to pick a correction', () => {
		const result = fitVeCorrections(synthetic({ center: true, ratio: () => 0.02 }));
		expect(result.status).toBe('no-supported-proposal');
		expect(result.candidate.changedCells).toHaveLength(0);
		expect(result.cells.every((c) => c.reasons.includes('GROUP_RANK_DEFICIENT'))).toBe(true);
	});
	it('suppresses direction-unstable proposals using training episodes only', () => {
		const result = fitVeCorrections(
			synthetic({
				ratio: (episode) => (episode % 4 === 0 ? (episode === 0 ? 0.1 : -0.02) : 0.015)
			}),
			{ huberThreshold: 1 }
		);
		expect(result.cells[0].reasons).toContain('LOO_DIRECTION_UNSTABLE');
		expect(result.cells[0].finalCorrectionPct).toBe(0);
		expect(result.passes.length).toBeGreaterThan(1);
	});
	it('suppresses excessive LOO variation, freezes the cell, and refits the remaining ridge system', () => {
		const dataset = synthetic({
			ratio: (episode) =>
				episode % 4 === 0 ? ([0.005, 0.015, 0.025, 0.035][Math.floor(episode / 4)] ?? 0.02) : -0.015
		});
		const result = fitVeCorrections(dataset, { huberThreshold: 1, maxLooRangePct: 0.5 });
		expect(result.cells[0].reasons).toContain('LOO_EXCESSIVE_RANGE');
		expect(result.passes.length).toBeGreaterThan(1);
		expect(result.passes.at(-1)!.activeCellIndices).not.toContain(0);
		const episodeFraction = 4 / 14;
		expect(result.cells[1].finalCorrectionPct).toBeCloseTo(
			(100 * -0.015 * episodeFraction) / (episodeFraction + (2 * 0.01) / 3),
			5
		);
	});
	it('does not accept unfinished optimization', () => {
		const result = fitVeCorrections(synthetic(), { maxIterations: 1, gradientTolerance: 1e-16 });
		expect(result.status).toBe('no-supported-proposal');
		expect(result.cells.every((c) => c.reasons.includes('SOLVER_ITERATION_LIMIT'))).toBe(true);
	});
	it('suppresses small proposals and reports bound hits', () => {
		const small = fitVeCorrections(synthetic({ ratio: () => 0.001 }));
		expect(small.cells.every((c) => c.reasons.includes('BELOW_MINIMUM_PROPOSAL'))).toBe(true);
		const bound = fitVeCorrections(synthetic({ ratio: () => 0.2 }));
		expect(
			bound.cells.every((c) => c.status === 'accepted' && c.atBound && c.finalCorrectionPct === 3)
		).toBe(true);
	});
	it('keeps holdout outcomes entirely outside fitting and selection', () => {
		const a = fitAndEvaluateVeCorrections(synthetic()),
			b = fitAndEvaluateVeCorrections(synthetic({ holdoutAfr: 19 }));
		expect(a.fit.trainingFingerprint).toBe(b.fit.trainingFingerprint);
		expect(a.fit.cells).toEqual(b.fit.cells);
		expect(a.fit.passes).toEqual(b.fit.passes);
		expect(a.fit.candidate.values).toEqual(b.fit.candidate.values);
		expect(a.evaluation.paired.baseline.mae).not.toBe(b.evaluation.paired.baseline.mae);
	});
	it('suppresses a group that loses rank when one influential training episode is omitted', () => {
		const dataset = synthetic({
			ratio: () => 0.02,
			coordinates: (episode, index) =>
				episode === 0 ? [index < 35 ? 1250 : 1750, 70] : [episode % 2 ? 1000 : 2000, 50]
		});
		const result = fitVeCorrections(dataset);
		expect(result.passes[0].conditioning.every((g) => g.status === 'identifiable')).toBe(true);
		expect(result.cells.every((c) => c.reasons.includes('LOO_GROUP_RANK_DEFICIENT'))).toBe(true);
		expect(result.candidate.changedCells).toHaveLength(0);
	});
	it('reports insufficient remaining LOO episode evidence rather than weakening the policy', () => {
		const result = fitVeCorrections(synthetic(), { minLooRemainingEpisodes: 20 });
		expect(result.cells.every((c) => c.reasons.includes('LOO_INSUFFICIENT_EPISODES'))).toBe(true);
	});
	it('preserves stricter Phase A bounds and all original evidence gates', () => {
		const bounded = fitVeCorrections(
			synthetic({ ratio: () => 0.05, preparation: { maxCorrectionPct: 1 } })
		);
		expect(bounded.bounds).toEqual({ requestedMaxPct: 3, datasetMaxPct: 1, effectiveMaxPct: 1 });
		expect(bounded.candidate.changedCells.every((c) => c.percent === 1)).toBe(true);
		const unsupported = fitVeCorrections(
			synthetic({ preparation: { minTrainingEpisodesPerCell: 30 } })
		);
		expect(unsupported.cells.every((c) => c.status === 'unsupported')).toBe(true);
		expect(unsupported.passes).toHaveLength(0);
	});
	it.each([
		{ huberThreshold: 0 },
		{ ridgePenalty: -1 },
		{ maxConditionNumber: 0.5 },
		{ relativeRankTolerance: 0 },
		{ gradientTolerance: 0 },
		{ minLooRemainingEpisodes: 1.2 },
		{ maxIterations: 0 },
		{ typo: 1 }
	])('rejects invalid numerical settings %j', (config) => {
		expect(() => veFitConfig(config)).toThrow();
	});
});

it.each([
	['2025-04-12_16.16.28.msl', 'steady-afr-ve-v1'],
	['2026-07-25_17.56.47.msl', 'steady-afr-ve-v1'],
	['2025-04-12_16.16.28.msl', 'steady-afr-ve-v2-experimental'],
	['2026-07-25_17.56.47.msl', 'steady-afr-ve-v2-experimental']
] as const)(
	'real-log fitting smoke test: %s, %s',
	(file, version) => {
		const { session, categorical } = parseMslWithEligibilityEvidence(
			decodeMsl(readFileSync(`data/logs/block1/${file}`)).content,
			file
		);
		const afr = importTunerStudioXml(readFileSync('tests/fixtures/xml/afr.table', 'utf8')),
			ve = importTunerStudioXml(readFileSync('tests/fixtures/xml/ve.table', 'utf8'));
		const dataset = prepareVeEvaluationDataset({
			session,
			categorical,
			targetAfrTable: { ...bind(afr.table, 'AFR'), ...afr },
			veTable: { ...bind(ve.table, 'VE'), ...ve },
			eligibilityProfile: { version }
		});
		const result = fitAndEvaluateVeCorrections(dataset);
		expect(result.evaluation.paired.rowCount).toBe(dataset.coverage.holdoutRows);
		for (const change of result.fit.candidate.changedCells) {
			expect(Math.abs(change.percent)).toBeLessThanOrEqual(3);
			expect(
				dataset.cells.find((c) => c.rpmIndex === change.rpmIndex && c.mapIndex === change.mapIndex)!
					.status
			).toBe('supported');
		}
		expect(
			result.fit.cells.every(
				(c) =>
					c.status !== 'accepted' || (c.stability!.directionStable && c.stability!.rangePct! <= 2)
			)
		).toBe(true);
	},
	60000
);
