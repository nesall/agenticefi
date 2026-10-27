import type { ChannelResolution, ChannelSlot } from './channelMapping';
import type {
	EligibilityConfig,
	EligibilityStatus,
	EligibilitySummary,
	SampleEligibility
} from './sampleEligibility';
import type { InvestigationResult } from './investigation';

export type SessionSummary = {
	id: string;
	logName: string;
	calibrationId: string;
	rowCount: number;
	channelCount: number;
	logEncoding: string;
	expiresAt: number;
	startSec: number;
	endSec: number;
	mappings: ChannelResolution[];
	profile: EligibilityConfig;
	eligibility: EligibilitySummary;
	calibrations: { kind: 'VE' | 'AFR'; rows: number; columns: number; writeDate: string | null }[];
	limitations: string[];
	museAvailable: boolean;
};
export type PlotPoint = {
	rowIndex: number;
	timeSec: number;
	values: (number | null)[];
	status: EligibilityStatus;
};
export type TelemetryResponse = {
	sessionId: string;
	startSec: number;
	endSec: number;
	slots: ChannelSlot[];
	resolutions: ChannelResolution[];
	segments: PlotPoint[][];
	invalidTimeCount: number;
	pointCount: number;
};
export type EligibilityPage = {
	sessionId: string;
	summary: EligibilitySummary;
	fullSummary: EligibilitySummary;
	profile: EligibilityConfig;
	samples: SampleEligibility[];
	total: number;
	offset: number;
	limit: number;
	focusedSample: SampleEligibility | null;
	unlocatableTimeCount: number;
};
export type InvestigationJob = {
	id: string;
	sessionId: string;
	state: 'running' | 'finished';
	startedAt: number;
	finishedAt: number | null;
	startSec: number;
	endSec: number;
	result: InvestigationResult | null;
	error: string | null;
};
