import type { InvestigationJob } from '../../shared/types/dashboard';
import type { InvestigationProgress } from '../../shared/types/analyticalDashboard';

export const investigationPhaseLabels: Record<InvestigationProgress['phase'], string> = {
	preparing: 'Preparing',
	'awaiting-model': 'Analyzing',
	'executing-tool': 'Running analysis tool',
	finalizing: 'Finalizing',
	finished: 'Finished'
};

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

/** Presentation gate only. Require accessible results and matching server provenance, not attempted calls. */
export function finalReportTimedOutAfterVeEvaluation(job: InvestigationJob): boolean {
	if (
		job.state !== 'finished' ||
		job.mode !== 'analytical' ||
		job.source === 'recorded' ||
		job.termination?.code !== 'deadline' ||
		job.termination.phase !== 'model' ||
		job.result?.status !== 'timeout'
	)
		return false;
	const p = job.presentation,
		manifest = job.result.analytical;
	if (
		!p?.datasetId ||
		!manifest ||
		!p.veAxes ||
		p.omittedCells !== 0 ||
		!p.veAxes.rpm.length ||
		!p.veAxes.mapKpa.length ||
		p.cells.length !== p.veAxes.rpm.length * p.veAxes.mapKpa.length ||
		!p.cells.every(
			(c) =>
				Number.isFinite(c.originalVe) &&
				c.originalVe !== null &&
				Number.isFinite(c.proposedVe) &&
				c.proposedVe !== null
		) ||
		p.paired?.status !== 'complete' ||
		p.paired.rowCount <= 0 ||
		p.paired.failedPredictions !== 0 ||
		!p.paired.candidate
	)
		return false;
	if (
		![
			p.paired.baseline.mae,
			p.paired.baseline.rmse,
			p.paired.candidate.mae,
			p.paired.candidate.rmse
		].every((v) => typeof v === 'number' && Number.isFinite(v))
	)
		return false;
	const refs = manifest.evidenceRefs.filter(
		(r) =>
			r.runId === manifest.runId &&
			r.settingsId === manifest.settingsId &&
			r.datasetId === p.datasetId
	);
	const candidate = refs.find((r) => r.kind === 'candidate' && r.candidateId);
	if (!candidate) return false;
	return (['fit', 'evaluation'] as const).every((kind) => {
		const artifact = refs.find((r) => r.kind === kind && r.candidateId === candidate.candidateId);
		if (!artifact) return false;
		return job.result!.trace.some((t) => {
			if (
				t.tool !== (kind === 'fit' ? 'fit_ve_candidate' : 'evaluate_ve_candidate') ||
				!t.result.ok
			)
				return false;
			const data = record(t.result.data),
				ref = record(data.fullEvidenceRef);
			return (
				data.candidateRef === candidate.artifactId &&
				ref.artifactId === artifact.artifactId &&
				ref.sha256 === artifact.sha256 &&
				ref.runId === manifest.runId &&
				ref.settingsId === manifest.settingsId &&
				ref.datasetId === p.datasetId &&
				ref.candidateId === candidate.candidateId
			);
		});
	});
}

export function investigationStatus(job: InvestigationJob): string {
	if (job.state === 'running') return 'Running';
	const code = job.termination?.code;
	if (code === 'deadline' || job.result?.status === 'timeout') return 'Deadline exceeded / partial';
	if (code === 'session-expired') return 'Session expired / partial';
	if (job.outcome === 'cancelled' || job.result?.status === 'cancelled') return 'Cancelled';
	if (code === 'incomplete-workflow') return 'Incomplete model workflow / partial';
	if (code?.startsWith('provider-')) return 'Provider error / partial';
	if (code?.startsWith('worker-')) return 'Worker failure / partial';
	if (code === 'invalid-report') return 'Invalid model report / partial';
	if (code === 'limit-reached') return 'Run limit reached / partial';
	return job.error || job.result?.status !== 'completed' ? 'Failed / partial' : 'Completed';
}
