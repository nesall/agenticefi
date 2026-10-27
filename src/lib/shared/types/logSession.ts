export interface Annotation {
	timeSec: number;
	label: string;
	color?: string; // e.g. "rgba(255, 178, 51, 1.0)"
}

export type DiscontinuityCause = 'StitchPoint' | 'DroppedFrames' | 'TimeInversion';

export interface DataDiscontinuity {
	cause: DiscontinuityCause;
	rowIndex: number;
	timeSec: number;
	durationSec: number;
	label: string;
}

export interface TimeCropRange {
	startSec: number;
	endSec: number;
	active: boolean;
}

export type StitchPosition = 'AppendToEnd' | 'PrependToBeginning';

export interface ChannelMergeResolution {
	activeChannelName: string;
	incomingChannelName: string; // Empty or "<NaN>" indicates fill with NaN
}
