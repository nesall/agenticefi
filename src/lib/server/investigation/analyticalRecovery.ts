import type {
	InvestigationModel,
	ToolTraceEntry,
	ToolName
} from '../../shared/types/investigation';
import type { AnalyticalEvidenceRef } from '../../shared/types/analyticalInvestigation';
import type { AnalyticalRun } from './analyticalRun';

const stages = ['analyze_afr_error', 'fit_ve_candidate', 'evaluate_ve_candidate'] as const;
export type AnalyticalStage = (typeof stages)[number];
export type AnalyticalFeedback = {
	type: 'analytical_workflow_incomplete';
	recoveryOpportunity: 1;
	missingStages: AnalyticalStage[];
	finalizedCandidateRef: string;
	message: string;
};
/** Server-side adapter capability only. Public API inputs and report schemas are unchanged. */
export type AnalyticalContinuationModel = InvestigationModel & {
	continueAnalyticalFinal(
		input: Parameters<InvestigationModel['next']>[0],
		feedback: AnalyticalFeedback,
		signal: AbortSignal
	): Promise<unknown>;
};
export function supportsAnalyticalContinuation(
	model: InvestigationModel
): model is AnalyticalContinuationModel {
	return 'continueAnalyticalFinal' in model && typeof model.continueAnalyticalFinal === 'function';
}
function data(entry: ToolTraceEntry): Record<string, unknown> {
	return entry.result.ok &&
		entry.result.data &&
		typeof entry.result.data === 'object' &&
		!Array.isArray(entry.result.data)
		? entry.result.data
		: {};
}
export function assessAnalyticalWorkflow(run: AnalyticalRun, trace: readonly ToolTraceEntry[]) {
	const manifest = run.manifest;
	const refs = manifest.evidenceRefs.filter(
		(r) => r.runId === run.runId && r.settingsId === run.settingsId
	);
	const candidate = refs.find((r) => r.kind === 'candidate');
	const succeeded = (name: ToolName) => trace.some((t) => t.tool === name && t.result.ok);
	const fitted =
		candidate &&
		refs.some(
			(r) =>
				r.kind === 'fit' &&
				r.candidateId === candidate.candidateId &&
				r.datasetId === candidate.datasetId
		) &&
		trace.some(
			(t) =>
				t.tool === 'fit_ve_candidate' &&
				t.result.ok &&
				data(t).candidateRef === candidate.artifactId
		);
	const evaluated =
		fitted &&
		refs.some(
			(r) =>
				r.kind === 'evaluation' &&
				r.candidateId === candidate.candidateId &&
				r.datasetId === candidate.datasetId
		) &&
		trace.some(
			(t) =>
				t.tool === 'evaluate_ve_candidate' &&
				t.result.ok &&
				data(t).candidateRef === candidate.artifactId
		);
	const analyzed = succeeded('analyze_afr_error') && refs.some((r) => r.kind === 'analysis');
	const missingStages = stages.filter((s) =>
		s === 'analyze_afr_error' ? !analyzed : s === 'fit_ve_candidate' ? !fitted : !evaluated
	);
	// Only private worker evidence can verify a blocker; model commentary cannot establish one.
	const verifiedBlocker = run.facts.some(
		(f) =>
			f.kind === 'availability' &&
			f.values.missing.length > 0 &&
			refs.some((r) => r.kind === 'availability' && r.artifactId === f.artifact.artifactId) &&
			trace.some((t) => t.evidenceId === f.evidenceId && t.result.ok)
	);
	return {
		complete: missingStages.length === 0,
		verifiedBlocker,
		missingStages,
		candidate: fitted ? candidate : null
	};
}
export function recoveryFeedback(
	missingStages: AnalyticalStage[],
	candidate: AnalyticalEvidenceRef
): AnalyticalFeedback {
	return {
		type: 'analytical_workflow_incomplete',
		recoveryOpportunity: 1,
		missingStages: [...missingStages],
		finalizedCandidateRef: candidate.artifactId,
		message:
			'The final report is valid partial evidence, but required analytical stages are missing. You may continue using the available analytical tools and the existing finalized candidate, or explain why you cannot continue. Dataset, settings, candidate and original deadline are frozen. Do not refit, replace the candidate or repeat completed tool calls. A claimed inability is not a verified blocker. Return the existing final-report JSON format when finished.'
	};
}
export function candidateUnchanged(run: AnalyticalRun, locked: AnalyticalEvidenceRef): boolean {
	return run.manifest.evidenceRefs.some(
		(r) =>
			r.kind === 'candidate' &&
			r.runId === locked.runId &&
			r.settingsId === locked.settingsId &&
			r.artifactId === locked.artifactId &&
			r.sha256 === locked.sha256 &&
			r.datasetId === locked.datasetId &&
			r.candidateId === locked.candidateId
	);
}
