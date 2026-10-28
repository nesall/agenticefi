import type { AfrSummary } from './targetAfrError';
import type { FitCellDiagnostic } from './veFitting';
import type { PairedVeMetrics, VeDatasetContent } from './veEvaluation';
import type { ToolTraceEntry } from './investigation';

export type DemoId = 'april' | 'august8';
export type AnalyticalProfile = 'v1' | 'v2-experimental';
export type InvestigationProgress = {
	phase: 'preparing' | 'awaiting-model' | 'executing-tool' | 'finalizing' | 'finished';
	tool: string | null;
	completed: ToolTraceEntry[];
};
export type SupportingSample = {
	rowIndex: number;
	timeSec: number | null;
	rpm: number | null;
	mapKpa: number | null;
	measuredAfr: number | null;
	targetAfr: number | null;
};
export type DashboardAfrRegion = {
	rpmIndex: number;
	mapIndex: number;
	rpmBounds: number[];
	mapBoundsKpa: number[];
	summary: AfrSummary;
	samples: SupportingSample[];
};
export type DashboardVeCell = Pick<
	FitCellDiagnostic,
	| 'rpmIndex'
	| 'mapIndex'
	| 'status'
	| 'reasons'
	| 'finalCorrectionPct'
	| 'atBound'
	| 'materialTrainingSamples'
> & { rpm: number; mapKpa: number; originalVe: number | null; proposedVe: number | null };
export type AnalyticalPresentation = {
	datasetId: string | null;
	profile: string;
	coverage: VeDatasetContent['coverage'] | null;
	regions: DashboardAfrRegion[];
	cells: DashboardVeCell[];
	paired: PairedVeMetrics | null;
	affectedOnly: PairedVeMetrics | null;
	limitations: string[];
	omittedRegions: number;
	omittedCells: number;
};
