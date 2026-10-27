import type { Immutable, ManualVeCandidate, VeCandidateEvaluation } from './veEvaluation';

export type VeFitConfig = {
	maxCorrectionPct: number;
	huberThreshold: number;
	ridgePenalty: number;
	maxConditionNumber: number;
	relativeRankTolerance: number;
	minCorrectionPct: number;
	maxLooRangePct: number;
	minLooRemainingEpisodes: number;
	maxIterations: number;
	gradientTolerance: number;
};
export type FitConditioning = {
	cellIndices: number[];
	rank: number;
	columns: number;
	conditionNumber: number | null;
	minEigenvalue: number | null;
	maxEigenvalue: number | null;
	status: 'identifiable' | 'rank-deficient' | 'ill-conditioned' | 'numerical-failure';
};
export type FitSolverDiagnostic = {
	status: 'converged' | 'iteration-limit' | 'numerical-failure';
	iterations: number;
	objective: number | null;
	projectedGradient: number | null;
};
export type FitFoldDiagnostic = {
	omittedEpisodeId: number;
	status: 'converged' | 'insufficient-episodes' | 'conditioning-failure' | 'solver-failure';
	conditioning: FitConditioning[];
	solver: FitSolverDiagnostic | null;
};
export type FitCellDiagnostic = {
	cellIndex: number;
	rpmIndex: number;
	mapIndex: number;
	status: 'accepted' | 'suppressed' | 'unsupported';
	reasons: string[];
	materialTrainingSamples: number;
	qualifyingEpisodeIds: number[];
	trainingInfluenceMass: number;
	finalCorrectionPct: number;
	lastProposedPct: number | null;
	lastProposalPass: number | null;
	atBound: boolean;
	stability: {
		foldPercentages: { omittedEpisodeId: number; percent: number | null }[];
		minPct: number | null;
		maxPct: number | null;
		rangePct: number | null;
		directionStable: boolean | null;
	} | null;
};
export type FitPassDiagnostic = {
	pass: number;
	activeCellIndices: number[];
	conditioning: FitConditioning[];
	solver: FitSolverDiagnostic | null;
	folds: FitFoldDiagnostic[];
	frozen: { cellIndex: number; reasons: string[] }[];
};
export type VeFitResult = Immutable<{
	version: 've-joint-fit-v1';
	datasetId: string;
	trainingFingerprint: string;
	config: VeFitConfig;
	bounds: { requestedMaxPct: number; datasetMaxPct: number; effectiveMaxPct: number };
	trainingRows: number;
	trainingEpisodeIds: number[];
	invalidTrainingRowIndices: number[];
	status: 'candidate' | 'no-supported-proposal';
	cells: FitCellDiagnostic[];
	passes: FitPassDiagnostic[];
	candidate: ManualVeCandidate;
	limitations: string[];
}>;
export type VeFittedEvaluation = Immutable<{ fit: VeFitResult; evaluation: VeCandidateEvaluation }>;
