import { describe, expect, it } from 'vitest';
import { assertCoverageSupport } from '../src/lib/server/investigation/coverageConsistency';
import { projectRecording } from '../src/lib/server/recordedInvestigation';
import { context } from './investigation/helpers';
import august from './fixtures/analytical/august-v1-support.json';

describe('supported-cell presentation consistency', () => {
	it('preserves the genuine August V1 five-cell support count', () => {
		const session = {
			...context(),
			logName: '2026-08-08_11.19.56.msl',
			calibrationId: 'block2-calibration'
		};
		const result = projectRecording(august, 'august8', 'v1', session);
		expect(result.presentation.coverage?.supportedCells).toBe(5);
		expect(result.presentation.coverage?.totalCells).toBe(256);
		expect(result.presentation.coverage?.trainingRows).toBe(13950);
		// Missing cell details in a recording must not turn supported coverage into zero.
		expect(result.presentation.cells).toHaveLength(0);
	});
	it('rejects a recorded zero that contradicts the fit evidence', () => {
		const changed = structuredClone(august);
		const analysis = changed.validatedInvestigation.trace.find(
			(entry) => entry.tool === 'analyze_afr_error'
		)!;
		analysis.result.data.coverage!.supportedCells = 0;
		expect(() =>
			projectRecording(changed, 'august8', 'v1', {
				...context(),
				logName: '2026-08-08_11.19.56.msl',
				calibrationId: 'block2-calibration'
			})
		).toThrow(/disagree/);
	});
	it('keeps legitimate zero support distinct from unavailable evidence', () => {
		expect(() =>
			assertCoverageSupport(
				{ trainingRows: 607, holdoutRows: 183, supportedCells: 0, totalCells: 256 },
				0
			)
		).not.toThrow();
		expect(() => assertCoverageSupport(null)).not.toThrow();
		expect(() =>
			assertCoverageSupport({ trainingRows: 0, holdoutRows: 0, totalCells: 256 })
		).toThrow(/unavailable/);
	});
	it.each([-1, 257, Number.NaN])('rejects an invalid supported count %s', (supportedCells) => {
		expect(() =>
			assertCoverageSupport({ trainingRows: 1, holdoutRows: 1, supportedCells, totalCells: 256 })
		).toThrow();
	});
});
