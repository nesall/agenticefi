import type { ChannelResolution, ChannelSlot } from './channelMapping';
import type {
	EligibilityConfig,
	EligibilityStatus,
	EligibilitySummary,
	SampleEligibility
} from './sampleEligibility';
import type { InvestigationResult } from './investigation';
import type {
	DemoId,
	AnalyticalProfile,
	AnalyticalPresentation,
	InvestigationProgress
} from './analyticalDashboard';

export type SessionSummary = {
	demoId?: DemoId;
	recordings?: AnalyticalProfile[];
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
	logName?: string;
	calibrationId?: string;
	demoId?: DemoId;
	rowCount?: number;
	outcome?: 'completed' | 'failed' | 'cancelled';
	mode?: 'legacy' | 'analytical';
	source?: 'live' | 'recorded';
	profile?: AnalyticalProfile;
	progress?: InvestigationProgress;
	presentation?: AnalyticalPresentation | null;
	recordedAt?: string;
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
