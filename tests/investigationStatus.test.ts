import { describe, expect, it } from 'vitest';
import {
	finalReportTimedOutAfterVeEvaluation,
	investigationPhaseLabels,
	investigationStatus
} from '../src/lib/components/dashboard/investigationStatus';
import { evaluatedTimeoutJob } from './investigationPresentationFixtures';

describe('investigation progress presentation and retained analytical results', () => {
	it('maps internal phases to presentation labels without changing their keys', () => {
		expect(investigationPhaseLabels['awaiting-model']).toBe('Analyzing');
		expect(investigationPhaseLabels['executing-tool']).toBe('Running analysis tool');
	});
	it('recognizes accessible evaluated zero-correction candidates, even with worsened predictions, while remaining partial', () => {
		const job = evaluatedTimeoutJob();
		expect(finalReportTimedOutAfterVeEvaluation(job)).toBe(true);
		expect(investigationStatus(job)).toBe('Deadline exceeded / partial');
		expect(job.presentation!.paired!.candidate!.mae).toBe(1.1);
	});
	it.each([
		'attempt-only',
		'failed-tool',
		'no-candidate',
		'cross-run',
		'cross-settings',
		'wrong-dataset',
		'wrong-candidate',
		'trace-mismatch',
		'no-presentation',
		'no-cells',
		'missing-values',
		'omitted-cells',
		'no-paired',
		'empty',
		'prediction-failure',
		'no-metrics',
		'tool-timeout',
		'cancelled',
		'recorded',
		'running'
	] as const)('does not claim completed evaluation for %s', (fault) => {
		const job = evaluatedTimeoutJob();
		const refs = job.result!.analytical!.evidenceRefs;
		if (fault === 'attempt-only') job.result!.trace = [];
		if (fault === 'failed-tool') job.result!.trace[1].result = { ok: false, error: 'Unavailable' };
		if (fault === 'no-candidate') refs.splice(0, 1);
		if (fault === 'cross-run') refs[2].runId = 'other';
		if (fault === 'cross-settings') refs[2].settingsId = 'other';
		if (fault === 'wrong-dataset') job.presentation!.datasetId = 'other';
		if (fault === 'wrong-candidate') refs[2].candidateId = 'other';
		if (fault === 'trace-mismatch') {
			const t = job.result!.trace[1];
			if (t.result.ok) t.result.data = { candidateRef: 'other' };
		}
		if (fault === 'no-presentation') job.presentation = null;
		if (fault === 'no-cells') job.presentation!.cells = [];
		if (fault === 'missing-values') job.presentation!.cells[0].proposedVe = null;
		if (fault === 'omitted-cells') job.presentation!.omittedCells = 1;
		if (fault === 'no-paired') job.presentation!.paired = null;
		if (fault === 'empty') {
			job.presentation!.paired!.status = 'empty';
			job.presentation!.paired!.rowCount = 0;
		}
		if (fault === 'prediction-failure') job.presentation!.paired!.status = 'prediction-failure';
		if (fault === 'no-metrics') job.presentation!.paired!.candidate!.mae = null;
		if (fault === 'tool-timeout') job.termination!.phase = 'tool';
		if (fault === 'cancelled') job.termination!.code = 'cancelled';
		if (fault === 'recorded') job.source = 'recorded';
		if (fault === 'running') job.state = 'running';
		expect(finalReportTimedOutAfterVeEvaluation(job)).toBe(false);
	});
});
