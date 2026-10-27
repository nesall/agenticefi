import type {
	AfrErrorStatistics,
	CalibrationProvenance,
	CoordinateLookup,
	SampleAfrError
} from './targetAfrError';
import type { EligibilityConfig } from './sampleEligibility';
import type { ExperimentalEligibilityConfig } from './sampleEligibilityV2';
import type { ChannelResolution } from './channelMapping';

export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type VePreparationConfig = {
	trainingFraction: number;
	episodeMergeGapSec: number;
	embargoSec: number;
	maxObservationGapSec: number;
	maxCorrectionPct: number;
	minTrainingSamplesPerCell: number;
	minTrainingEpisodesPerCell: number;
	minEpisodeSupportSec: number;
	minRelativeInfluence: number;
};
export type VePartition = 'training' | 'holdout' | 'embargo' | 'unassigned';
export type VeEpisode = {
	id: number;
	segmentId: number;
	startRow: number;
	endRow: number;
	startTimeSec: number;
	endTimeSec: number;
	initialEligibleCount: number;
	partition: VePartition;
};
export type VeInfluence = {
	rpmIndex: number;
	mapIndex: number;
	bilinearWeight: number;
	originalVe: number | null;
	relativeInfluence: number | null;
};
export type VeLookup = {
	location: CoordinateLookup;
	status: 'available' | 'coordinates-unavailable' | 'missing-ve' | 'invalid-ve' | 'nonfinite-ve';
	value: number | null;
	corners: VeInfluence[];
};
export type VeTableSnapshot = {
	provenance: CalibrationProvenance;
	values: (number | null)[][];
};
export type VeEvaluationRow = {
	rowIndex: number;
	episodeId: number | null;
	partition: VePartition;
	status: 'ready' | 'excluded';
	reasons: string[];
	afr: SampleAfrError;
	ve: VeLookup;
	supportRows: { startRow: number; endRow: number } | null;
};
export type VeCellSupport = {
	rpmIndex: number;
	mapIndex: number;
	originalVe: number | null;
	status: 'supported' | 'unsupported';
	reasons: string[];
	materialTrainingSamples: number;
	trainingInfluenceMass: number;
	qualifyingEpisodeIds: number[];
	episodeEvidence: { episodeId: number; samples: number; longestContinuousSec: number }[];
};
export type VeDatasetContent = {
	version: 've-evaluation-phase-a-v1';
	config: VePreparationConfig;
	resolutions: ChannelResolution[];
	manifest: {
		sessionSha256: string;
		targetTableSha256: string;
		veTableSha256: string;
		classifierVersion: 'steady-afr-ve-v1' | 'steady-afr-ve-v2-experimental';
		classifierConfig: EligibilityConfig | ExperimentalEligibilityConfig;
		baseClassifierConfig: EligibilityConfig | null;
	};
	tables: { targetAfr: VeTableSnapshot; ve: VeTableSnapshot };
	split: {
		status: 'ready' | 'insufficient-separated-episodes';
		training: { startRow: number; endRowExclusive: number } | null;
		holdout: { startRow: number; endRowExclusive: number } | null;
		actualGapSec: number | null;
	};
	episodes: VeEpisode[];
	rows: VeEvaluationRow[];
	cells: VeCellSupport[];
	coverage: {
		trainingRows: number;
		holdoutRows: number;
		supportedCells: number;
		totalCells: number;
		exclusionCounts: Record<string, number>;
	};
	limitations: string[];
};
export type VeEvaluationDataset = Immutable<VeDatasetContent & { datasetId: string }>;
export type ManualVeChange = Readonly<{ rpmIndex: number; mapIndex: number; percent: number }>;
export type VeCandidateContent = {
	version: 'manual-ve-candidate-v1';
	datasetId: string;
	correctionFractions: number[][];
	values: (number | null)[][];
	changedCells: {
		rpmIndex: number;
		mapIndex: number;
		percent: number;
		originalVe: number;
		candidateVe: number;
	}[];
};
export type ManualVeCandidate = Immutable<VeCandidateContent & { candidateId: string }>;
export type VeErrorMetrics = {
	count: number;
	mae: number | null;
	rmse: number | null;
	errors: AfrErrorStatistics;
};
export type PairedVeMetrics = {
	status: 'complete' | 'empty' | 'prediction-failure';
	rowCount: number;
	failedPredictions: number;
	baseline: VeErrorMetrics;
	candidate: VeErrorMetrics | null;
	predictedDeltaMae: number | null;
	predictedDeltaRmse: number | null;
};
export type VePredictionRow = {
	rowIndex: number;
	episodeId: number;
	rpmIndex: number;
	mapIndex: number;
	affected: boolean;
	status: 'predicted' | 'numerical-failure';
	baselineAfr: number;
	targetAfr: number;
	originalVe: number;
	candidateVe: number | null;
	predictedAfr: number | null;
	baselineErrorAfr: number;
	predictedErrorAfr: number | null;
};
export type VeCandidateEvaluation = Immutable<{
	version: 've-model-prediction-v1';
	datasetId: string;
	candidateId: string;
	partition: 'training' | 'holdout';
	delay: { status: 'unimplemented-zero-placeholder'; appliedMs: 0 };
	rows: VePredictionRow[];
	paired: PairedVeMetrics;
	affectedOnly: PairedVeMetrics;
	byEpisode: { episodeId: number; paired: PairedVeMetrics }[];
	byNeighborhood: { rpmIndex: number; mapIndex: number; paired: PairedVeMetrics }[];
	changedNeighborhoods: {
		rpmIndex: number;
		mapIndex: number;
		evaluationRows: number;
		status: 'observed' | 'unassessed';
	}[];
	limitations: string[];
}>;
