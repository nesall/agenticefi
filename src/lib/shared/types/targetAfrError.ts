import type { ChannelResolution } from './channelMapping';
import type { EligibilityResult, EligibilityStatus } from './sampleEligibility';
import type { ExperimentalEligibilityResult } from './sampleEligibilityV2';

export type AfrEligibility = EligibilityResult | ExperimentalEligibilityResult;
export type TableNeighborhood = {
	rpmIndex: number;
	mapIndex: number;
	rpmBounds: [number, number];
	mapBoundsKpa: [number, number];
	rpmFraction: number;
	mapFraction: number;
};
export type CoordinateLookup = {
	rpm: number | null;
	mapKpa: number | null;
} & (
	| { status: 'ok'; neighborhood: TableNeighborhood }
	| { status: 'missing-input'; missingAxes: ('rpm' | 'mapKpa')[] }
	| {
			status: 'out-of-bounds';
			outsideAxes: { axis: 'rpm' | 'mapKpa'; value: number; bounds: [number, number] }[];
	  }
);
export type TableCorner = {
	rpmIndex: number;
	mapIndex: number;
	weight: number;
	value: number | null;
};
export type TableLookup = CoordinateLookup & {
	value: number | null;
	corners: TableCorner[];
	valueStatus:
		'available' | 'not-looked-up' | 'missing-cells' | 'invalid-target-afr' | 'nonfinite-result';
};
export type SampleAfrError = {
	rowIndex: number;
	timeSec: number | null;
	rpm: number | null;
	mapKpa: number | null;
	measuredAfr: number | null;
	eligibilityStatus: EligibilityStatus;
	eligibilityReasonCodes: string[];
	target: TableLookup;
	veLocation: CoordinateLookup;
	errorStatus: 'available' | 'invalid-measured-afr' | 'target-unavailable' | 'nonfinite-error';
	errorAfr: number | null;
	contributesToAggregate: boolean;
	delayMs: 0;
};
export type AfrErrorStatistics = {
	count: number;
	mean: number | null;
	median: number | null;
	populationStdDev: number | null;
	q25: number | null;
	q75: number | null;
	iqr: number | null;
	mad: number | null;
	min: number | null;
	max: number | null;
};
export type AfrAnalysisCounts = {
	considered: number;
	eligible: number;
	excluded: number;
	validError: number;
	eligibleValidError: number;
	grouped: number;
	targetStatusCounts: Record<string, number>;
	veLocationStatusCounts: Record<string, number>;
	errorStatusCounts: Record<SampleAfrError['errorStatus'], number>;
};
export type AfrAnalysisCoverage = {
	eligibleFractionOfConsidered: number | null;
	validErrorFractionOfEligible: number | null;
	groupedFractionOfEligible: number | null;
};
export type AfrSummary = {
	counts: AfrAnalysisCounts;
	coverage: AfrAnalysisCoverage;
	error: AfrErrorStatistics;
	supportingRows: {
		minimumErrorRow: number | null;
		maximumErrorRow: number | null;
		nearestMedianRow: number | null;
	};
};
export type NeighborhoodAfrSummary = AfrSummary & {
	rpmIndex: number;
	mapIndex: number;
	rpmBounds: [number, number];
	mapBoundsKpa: [number, number];
};
export type CalibrationProvenance = {
	sourceId: string;
	xAxisName: string;
	yAxisName: string;
	rpmAxis: number[];
	mapAxisKpa: number[];
	xQuantity: 'engineSpeed';
	xUnit: 'rpm';
	yQuantity: 'manifoldPressure';
	yUnit: 'kPa';
	valueUnit: 'AFR' | 'VE';
};
export type TargetAfrErrorAnalysis = {
	analysisVersion: 'target-afr-error-v1';
	classifierVersion: AfrEligibility['classifierVersion'];
	eligibilityConfig: AfrEligibility['config'];
	baseEligibilityConfig: EligibilityResult['config'] | null;
	partition: { startRow: number; endRowExclusive: number };
	tables: { targetAfr: CalibrationProvenance; ve: CalibrationProvenance };
	resolutions: ChannelResolution[];
	delay: { status: 'unimplemented-zero-placeholder'; appliedMs: 0 };
	samples: SampleAfrError[];
	summary: AfrSummary;
	neighborhoods: NeighborhoodAfrSummary[];
	gridCoverage: { occupiedNeighborhoods: number; totalNeighborhoods: number; fraction: number };
	limitations: string[];
};
