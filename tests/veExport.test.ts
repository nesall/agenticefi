import { describe, it, expect } from 'vitest';
import { Table2D } from '../src/lib/server/core/Table2D';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';
import { prepareVeEvaluationDataset } from '../src/lib/server/analysis/prepareVeEvaluation';
import { fitVeCorrections } from '../src/lib/server/analysis/fitVeCorrections';
import { createManualVeCandidate } from '../src/lib/server/analysis/predictVeCandidate';
import { veContentHash } from '../src/lib/server/analysis/veArtifacts';
import {
	createVeExportSnapshot,
	veExportCsv,
	veExportProvenance
} from '../src/lib/server/investigation/veExport';
import type { AnalysisCalibration } from '../src/lib/server/analysis/targetAfrError';
import { AnalyticalRun } from '../src/lib/server/investigation/analyticalRun';
import { afrXml } from './investigation/helpers';

function fixture(changes = [3, -3, 1.23456789012345]) {
	const rpm = Array.from({ length: 16 }, (_, i) => 800 + i * i * 30);
	const map = Array.from({ length: 16 }, (_, i) => 20 + i * 7);
	const values = map.map((_, y) => rpm.map((_, x) => 40.12345678901234 + x + y));
	const bind = <U extends 'VE' | 'AFR'>(unit: U): AnalysisCalibration<U> => ({
		table: Table2D.fromJSON({
			xBreakpoints: rpm,
			yBreakpoints: map,
			values: unit === 'VE' ? values : values.map((row) => row.map(() => 14))
		}),
		sourceId: unit,
		xAxisName: 'rpm',
		yAxisName: 'load',
		xQuantity: 'engineSpeed',
		xUnit: 'rpm',
		yQuantity: 'manifoldPressure',
		yUnit: 'kPa',
		valueUnit: unit
	});
	const parsed = parseMslWithEligibilityEvidence(
		'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1000\t50\t14\n1\t1000\t50\t14'
	);
	const base = prepareVeEvaluationDataset({
		...parsed,
		targetAfrTable: bind('AFR'),
		veTable: bind('VE'),
		eligibilityProfile: { version: 'steady-afr-ve-v1' }
	});
	const fitted = fitVeCorrections(base);
	const { datasetId: _, ...content } = base;
	void _;
	const supported = {
		...content,
		cells: content.cells.map((c, i) =>
			i < changes.length ? { ...c, status: 'supported' as const, reasons: [] } : c
		)
	};
	const dataset = { ...supported, datasetId: veContentHash(supported) };
	const candidate = createManualVeCandidate(
		dataset,
		changes.map((percent, x) => ({ rpmIndex: x, mapIndex: 0, percent }))
	);
	const fit = {
		...fitted,
		datasetId: dataset.datasetId,
		candidate,
		cells: fitted.cells.map((c) => ({
			...c,
			status:
				c.mapIndex === 0 && c.rpmIndex < changes.length
					? ('accepted' as const)
					: c.rpmIndex === 15
						? ('suppressed' as const)
						: ('unsupported' as const),
			finalCorrectionPct: c.mapIndex === 0 ? (changes[c.rpmIndex] ?? 0) : 0,
			atBound: c.mapIndex === 0 && Math.abs(changes[c.rpmIndex] ?? 0) === 3
		}))
	};
	return {
		calibrationId: 'synthetic',
		profile: 'steady-afr-ve-v1',
		original: { xBreakpoints: rpm, yBreakpoints: map, values },
		dataset,
		fit,
		fitSha256: veContentHash(fit),
		candidateSha256: veContentHash(candidate)
	};
}
describe('immutable advisory VE data export', () => {
	it('copies exact finalized values with positive, negative and at-bound changes; preserves axes and unchanged cells', () => {
		const input = fixture(),
			snapshot = createVeExportSnapshot(input);
		expect(snapshot.values).toEqual(input.fit.candidate.values);
		expect(snapshot.values[0][0]).toBe(input.original.values[0][0] * 1.03);
		expect(snapshot.values[0][1]).toBe(input.original.values[0][1] * 0.97);
		expect(snapshot.values[1][15]).toBe(input.original.values[1][15]);
		expect(snapshot.values[1][1]).toBe(input.original.values[1][1]);
		expect(snapshot.corrections).toMatchObject({ changed: 3, atBound: 2 });
		expect(Object.isFrozen(snapshot.values[0])).toBe(true);
		const csv = veExportCsv(snapshot)
			.trim()
			.split('\r\n')
			.map((row) => row.split(','));
		expect(csv).toHaveLength(17);
		expect(csv[0].slice(1).map(Number)).toEqual(input.original.xBreakpoints);
		expect(csv.slice(1).map((row) => Number(row[0]))).toEqual(input.original.yBreakpoints);
		expect(csv.slice(1).map((row) => row.slice(1).map(Number))).toEqual(input.fit.candidate.values);
		input.original.values[0][0] = 999;
		expect(snapshot.values[0][0]).not.toBe(999);
	});
	it('exports an unchanged no-correction candidate and minimal partial/unavailable provenance', () => {
		const input = fixture([]),
			snapshot = createVeExportSnapshot(input);
		expect(snapshot.values).toEqual(input.original.values);
		expect(snapshot.corrections.changed).toBe(0);
		const provenance = veExportProvenance(snapshot, true, false);
		expect(provenance).toMatchObject({
			investigation: 'partial',
			evaluation: 'unavailable',
			advisoryOnly: true,
			directlyImportableCalibration: false
		});
		expect(Object.keys(provenance)).not.toContain('values');
		expect(JSON.stringify(provenance)).not.toMatch(
			/rowIndex|trace|credential|logContent|filesystem/
		);
	});
	it.each([
		'axis',
		'missing',
		'null',
		'calibration',
		'nonfinite',
		'dataset',
		'candidate',
		'fit',
		'unsupported',
		'bounds'
	] as const)('refuses invalid snapshot: %s', (fault) => {
		const input = fixture();
		if (fault === 'axis') input.original.xBreakpoints.pop();
		if (fault === 'missing') input.original.values.pop();
		if (fault === 'nonfinite') input.original.values[0][0] = NaN;
		if (fault === 'null') {
			const original = {
				...input.original,
				values: input.original.values.map((row) => [...row] as (number | null)[])
			};
			original.values[0][0] = null;
			expect(() => createVeExportSnapshot({ ...input, original })).toThrow();
			return;
		}
		if (fault === 'calibration') input.original.values[0][0] += 1;
		if (fault === 'dataset') input.dataset.datasetId = 'wrong';
		if (fault === 'candidate') input.candidateSha256 = 'wrong';
		if (fault === 'fit') input.fitSha256 = 'wrong';
		if (fault === 'unsupported') {
			input.fit.cells[0].status = 'unsupported';
			input.fitSha256 = veContentHash(input.fit);
		}
		if (fault === 'bounds') {
			input.fit = { ...input.fit, bounds: { ...input.fit.bounds, effectiveMaxPct: 1 } };
			input.fitSha256 = veContentHash(input.fit);
		}
		expect(() => createVeExportSnapshot(input)).toThrow();
	});
	it('snapshot failure leaves a successful tool intact for non-16x16 tables', async () => {
		const run = new AnalyticalRun(
			{
				contextId: 'test',
				calibrationId: 'test',
				calibrationSemantics: 'rpm-map-kpa-afr',
				logName: 'test.msl',
				logContent: 'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1500\t50\t14\n1\t1500\t50\t14',
				veXml: afrXml,
				afrXml
			},
			{ checkpointPresentation: true }
		);
		try {
			expect((await run.executeTool('fit_ve_candidate', {}, 'evidence-1')).ok).toBe(true);
			expect(run.exportCheckpoint).toBeNull();
		} finally {
			await run.dispose();
		}
	});
});
