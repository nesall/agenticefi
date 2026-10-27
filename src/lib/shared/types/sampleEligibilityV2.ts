import type { EligibilityConfig, EligibilityReason, EligibilityStatus } from './sampleEligibility';

export type ExperimentalEligibilityConfig = {
	rpmMethod: 'adjacent' | 'windowed';
	windowAlignment: 'trailing' | 'centered';
	windowSec: number;
	maxAbsSlopeRpmPerSec: number;
	maxCentralSpreadRpm: number;
	maxRangeRpm: number;
	maxAdjacentJumpRpm: number;
	minObservations: number;
	maxObservationGapSec: number;
	maxEndpointBracketSec: number;
	requireFuelCutEvidence: boolean;
	requireOverrunFuelCutEvidence: boolean;
};
export type ExperimentalReason = {
	code: string;
	category: 'hard' | 'heuristic' | 'unassessed';
	blocking: boolean;
	evidence: Record<string, unknown>;
};
export type StabilityWindow = {
	requestedStartSec: number;
	requestedEndSec: number;
	startRow: number | null;
	endRow: number | null;
	actualStartSec: number | null;
	actualEndSec: number | null;
	observationCount: number;
	slopeRpmPerSec?: number;
	centralSpreadRpm?: number;
	rangeRpm?: number;
};
export type ExperimentalSample = {
	rowIndex: number;
	timeSec: number | null;
	status: EligibilityStatus;
	baseReasons: EligibilityReason[];
	reasons: ExperimentalReason[];
	window: StabilityWindow | null;
	categorical: Record<
		'fuelCut' | 'overrunFuelCut',
		{
			state: 'active' | 'inactive' | 'unknown' | 'absent';
			raw: string | null;
			sourceLine: number | null;
			required: boolean;
		}
	>;
};
export type ExperimentalEligibilityResult = {
	classifierVersion: 'steady-afr-ve-v2-experimental';
	config: ExperimentalEligibilityConfig;
	baseConfig: EligibilityConfig;
	partition: { startRow: number; endRowExclusive: number };
	samples: ExperimentalSample[];
	summary: { statuses: Record<EligibilityStatus, number>; reasonCounts: Record<string, number> };
};
