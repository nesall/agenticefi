import type { InvestigationJob } from '../src/lib/shared/types/dashboard';
import type { AnalyticalEvidenceRef } from '../src/lib/shared/types/analyticalInvestigation';

/** Synthetic server projection with explicit, matching candidate/evaluation provenance. */
export function evaluatedTimeoutJob(): InvestigationJob {
	const ref = (kind: AnalyticalEvidenceRef['kind']): AnalyticalEvidenceRef => ({
		kind,
		runId: 'r',
		contextId: 's',
		settingsId: 'settings',
		artifactId: `r:${kind}`,
		sha256: `${kind}-hash`,
		datasetId: 'dataset',
		candidateId: 'candidate'
	});
	const candidate = ref('candidate'),
		fit = ref('fit'),
		evaluation = ref('evaluation');
	const errors = {
		count: 2,
		mean: 0,
		median: 0,
		populationStdDev: 0,
		min: 0,
		max: 0,
		q25: 0,
		q75: 0,
		iqr: 0,
		mad: 0
	};
	const paired = {
		status: 'complete' as const,
		rowCount: 2,
		failedPredictions: 0,
		baseline: { count: 2, mae: 1, rmse: 1, errors },
		candidate: { count: 2, mae: 1.1, rmse: 1.1, errors },
		predictedDeltaMae: 0.1,
		predictedDeltaRmse: 0.1
	};
	return {
		id: 'j',
		sessionId: 's',
		mode: 'analytical',
		source: 'live',
		profile: 'v1',
		state: 'finished',
		outcome: 'failed',
		startedAt: 0,
		finishedAt: 180000,
		startSec: 0,
		endSec: 10,
		error:
			'Investigation deadline exceeded (180 seconds) while awaiting model turn 6. Completed evidence is retained.',
		termination: { code: 'deadline', phase: 'model', modelTurn: 6, tool: null },
		result: {
			status: 'timeout',
			reason: 'deadline',
			report: null,
			analytical: {
				runId: 'r',
				settingsId: 'settings',
				evidenceRefs: [candidate, fit, evaluation],
				timings: []
			},
			trace: [
				{
					tool: 'fit_ve_candidate',
					evidenceId: 'evidence-1',
					arguments: {},
					result: {
						ok: true,
						data: {
							status: 'no-supported-proposal',
							candidateRef: candidate.artifactId,
							fullEvidenceRef: fit
						}
					}
				},
				{
					tool: 'evaluate_ve_candidate',
					evidenceId: 'evidence-2',
					arguments: { candidateRef: candidate.artifactId },
					result: {
						ok: true,
						data: {
							status: 'complete',
							candidateRef: candidate.artifactId,
							fullEvidenceRef: evaluation,
							paired
						}
					}
				}
			]
		},
		presentation: {
			datasetId: 'dataset',
			profile: 'steady-afr-ve-v1',
			veAxes: { rpm: [1000], mapKpa: [50] },
			cells: [
				{
					rpmIndex: 0,
					mapIndex: 0,
					rpm: 1000,
					mapKpa: 50,
					status: 'unsupported',
					reasons: ['INSUFFICIENT_TRAINING_SAMPLES'],
					finalCorrectionPct: 0,
					atBound: false,
					materialTrainingSamples: 0,
					originalVe: 40,
					proposedVe: 40
				}
			],
			regions: [],
			coverage: null,
			paired,
			affectedOnly: null,
			limitations: [],
			omittedCells: 0,
			omittedRegions: 0
		}
	};
}
