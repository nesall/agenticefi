import type { ChannelResolution, ChannelSlot } from './channelMapping';

export type EligibilityConfig = {
	minCoolantC: number | null;
	maxWarmupCorrectionDeviationPct: number | null;
	maxAbsTpsRatePctPerSec: number | null;
	maxAbsMapRateKpaPerSec: number | null;
	maxAbsRpmRatePerSec: number | null;
	maxGapSec: number | null;
	steadyWindowSec: number;
	possibleFuelCutMaxPulseWidthMs: number | null;
	possibleFuelCutMinRpm: number;
	possibleFuelCutMaxTpsPct: number;
};
export type EligibilityCheck =
	| 'core'
	| 'timeContinuity'
	| 'timeGap'
	| 'warmupTemperature'
	| 'warmupCorrection'
	| 'tpsTransient'
	| 'mapTransient'
	| 'rpmTransient'
	| 'possibleFuelCut'
	| 'steadyWindow';
export type EligibilityStatus =
	'hard-excluded' | 'heuristic-excluded' | 'indeterminate' | 'eligible';
export type EligibilityEvidence = {
	rowIndex: number;
	channelName: string | null;
	slot: ChannelSlot | 'time';
	value: number | null;
	unit: string | null;
	method:
		| 'normalized-sample'
		| 'logged-rate'
		| 'finite-difference'
		| 'absolute-deviation'
		| 'time'
		| 'time-interval'
		| 'steady-duration'
		| 'stitch';
	sourceValue?: number | null;
	windowStartSec?: number;
	previousRowIndex?: number;
	previousValue?: number | null;
	deltaSec?: number;
};
export type EligibilityThreshold = {
	configKey: keyof EligibilityConfig | 'positiveCoreValue' | 'strictlyIncreasingTime';
	operator: '>=' | '>' | '<=';
	value: number;
	unit: string;
};
export type EligibilityReason = {
	code: string;
	check: EligibilityCheck;
	category: 'hard' | 'heuristic' | 'unassessed';
	message: string;
	thresholds: EligibilityThreshold[];
	evidence: EligibilityEvidence[];
};
export type SampleEligibility = {
	rowIndex: number;
	timeSec: number | null;
	status: EligibilityStatus;
	checks: Record<EligibilityCheck, 'pass' | 'fail' | 'unassessed' | 'disabled'>;
	reasons: EligibilityReason[];
};
export type EligibilitySummary = {
	rowCount: number;
	statuses: Record<EligibilityStatus, number>;
	reasonCounts: Record<string, number>;
	checks: Record<EligibilityCheck, Record<'pass' | 'fail' | 'unassessed' | 'disabled', number>>;
};
export type EligibilityResult = {
	classifierVersion: 'steady-afr-ve-v1';
	config: EligibilityConfig;
	resolutions: ChannelResolution[];
	samples: SampleEligibility[];
	summary: EligibilitySummary;
	limitations: string[];
};
