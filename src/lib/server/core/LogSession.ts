import type {
	Annotation,
	ChannelMergeResolution,
	DataDiscontinuity,
	StitchPosition,
	TimeCropRange
} from '#lib/shared/types/logSession.ts';
import type { Channel } from './Channel';
import { ChannelMapping } from './ChannelMapping';

export class LogSession {
	private _channels: Channel[] = [];
	private _channelMapping: ChannelMapping = new ChannelMapping();
	private _rowCount: number = 0;
	private _timeChannelIndex?: number;

	private _sourcePath: string = '';
	private _formatInfo: string = '';
	private _captureDate: string = '';

	private _cropRange: TimeCropRange = { startSec: 0, endSec: 0, active: false };
	private _stitchPoints: number[] = [];
	private _annotations: Annotation[] = [];
	private _revision: number = 0;

	private _discontinuities: DataDiscontinuity[] = [];
	private _discontinuityRowIndices: Set<number> = new Set();
	private _nominalSampleDeltaSec: number = 0.0;

	addChannel(channel: Channel): void {
		this._channels.push(channel);
		this._revision++;
	}

	get channels(): Channel[] {
		return this._channels;
	}
	get rowCount(): number {
		return this._rowCount;
	}
	set rowCount(count: number) {
		this._rowCount = count;
	}

	get sourcePath(): string {
		return this._sourcePath;
	}
	set sourcePath(path: string) {
		this._sourcePath = path;
	}

	get formatInfo(): string {
		return this._formatInfo;
	}
	set formatInfo(info: string) {
		this._formatInfo = info;
	}

	get captureDate(): string {
		return this._captureDate;
	}
	set captureDate(date: string) {
		this._captureDate = date;
	}

	get timeChannelIndex(): number | undefined {
		return this._timeChannelIndex;
	}
	setTimeChannelIndex(index: number | undefined): void {
		this._timeChannelIndex = index;
	}

	get channelMapping(): ChannelMapping {
		return this._channelMapping;
	}
	setChannelMapping(mapping: ChannelMapping): void {
		this._channelMapping = mapping;
	}

	get annotations(): Annotation[] {
		return this._annotations;
	}
	setAnnotations(ann: Annotation[]): void {
		this._annotations = ann;
	}
	addAnnotation(ann: Annotation): void {
		this._annotations.push(ann);
		this._revision++;
	}

	get discontinuities(): DataDiscontinuity[] {
		return this._discontinuities;
	}
	isDiscontinuity(rowIndex: number): boolean {
		return this._discontinuityRowIndices.has(rowIndex);
	}

	findChannel(name: string): Channel | undefined {
		return this._channels.find((ch) => ch.name === name);
	}

	channelByIndex(i: number): Channel | undefined {
		return this._channels[i];
	}

	timeSec(): number[] | null {
		if (this._timeChannelIndex === undefined || this._timeChannelIndex >= this._channels.length) {
			return null;
		}
		return this._channels[this._timeChannelIndex].values;
	}

	// --- Cropping & Binary Search Helpers ---
	setCropRange(startSec: number, endSec: number): void {
		if (startSec > endSec) [startSec, endSec] = [endSec, startSec];
		this._cropRange = { startSec, endSec, active: true };
	}

	resetCropRange(): void {
		this._cropRange.active = false;
	}

	private lowerBound(arr: number[], target: number): number {
		let low = 0,
			high = arr.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (arr[mid] < target) low = mid + 1;
			else high = mid;
		}
		return low;
	}

	private upperBound(arr: number[], target: number): number {
		let low = 0,
			high = arr.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (arr[mid] <= target) low = mid + 1;
			else high = mid;
		}
		return low;
	}

	cropStartIndex(): number {
		const time = this.timeSec();
		if (!this._cropRange.active || !time || time.length === 0) return 0;
		return this.lowerBound(time, this._cropRange.startSec);
	}

	cropEndIndex(): number {
		const time = this.timeSec();
		if (!this._cropRange.active || !time || time.length === 0) {
			return this._rowCount > 0 ? this._rowCount - 1 : 0;
		}
		const idx = this.upperBound(time, this._cropRange.endSec);
		return idx > 0 ? idx - 1 : 0;
	}

	// --- Integrity & Discontinuity Diagnostics ---
	scanIntegrityAndBuildDiscontinuities(): void {
		this._discontinuities = [];
		this._discontinuityRowIndices.clear();
		this._nominalSampleDeltaSec = 0.0;

		const tSec = this.timeSec();
		if (!tSec || tSec.length < 3) return;

		const n = tSec.length;
		const sampleLimit = Math.min(n, 2001);
		const deltas: number[] = [];

		for (let i = 1; i < sampleLimit; ++i) {
			const dt = tSec[i] - tSec[i - 1];
			if (dt > 0.0) deltas.push(dt);
		}

		if (deltas.length === 0) return;
		deltas.sort((a, b) => a - b);
		this._nominalSampleDeltaSec = deltas[Math.floor(deltas.length / 2)];

		const dropThreshold = Math.max(0.05, this._nominalSampleDeltaSec * 2.5);
		const kEpsilon = 1e-5;

		for (let i = 1; i < n; ++i) {
			const tPrev = tSec[i - 1];
			const tCurr = tSec[i];
			const dt = tCurr - tPrev;
			const midpoint = (tPrev + tCurr) * 0.5;

			const isStitch = this._stitchPoints.some((sp) => sp >= tPrev - 1e-4 && sp <= tCurr + 1e-4);

			if (isStitch) {
				this._discontinuities.push({
					cause: 'StitchPoint',
					rowIndex: i,
					timeSec: midpoint,
					durationSec: dt,
					label: 'Stitch Seam'
				});
				this._discontinuityRowIndices.add(i);
				continue;
			}

			if (dt <= -kEpsilon) {
				this._discontinuities.push({
					cause: 'TimeInversion',
					rowIndex: i,
					timeSec: midpoint,
					durationSec: dt,
					label: 'Time Inversion (dt <= 0)'
				});
				this._discontinuityRowIndices.add(i);
			} else if (dt < kEpsilon) {
				continue; // Duplicate timestamp
			} else if (dt >= dropThreshold) {
				const missedFrames = Math.round(dt / this._nominalSampleDeltaSec) - 1;
				this._discontinuities.push({
					cause: 'DroppedFrames',
					rowIndex: i,
					timeSec: midpoint,
					durationSec: dt,
					label: `Drop +${(dt * 1000).toFixed(0)}ms (~${Math.max(1, missedFrames)} frames)`
				});
				this._discontinuityRowIndices.add(i);
			}
		}
	}

	// --- Session Stitching ---
	stitchSession(
		incoming: LogSession,
		position: StitchPosition,
		resolutions: ChannelMergeResolution[]
	): { success: boolean; error?: string } {
		if (incoming.rowCount === 0) {
			return { success: false, error: 'Incoming session has no rows.' };
		}

		if (this._rowCount === 0) {
			Object.assign(this, incoming);
			this._revision++;
			return { success: true };
		}

		const incomingLookup = new Map<string, Channel>();
		for (const ch of incoming.channels) {
			incomingLookup.set(ch.name, ch);
		}

		const curTime = this.timeSec();
		const incTime = incoming.timeSec();

		const curStart = curTime && curTime.length > 0 ? curTime[0] : 0.0;
		const curEnd = curTime && curTime.length > 0 ? curTime[curTime.length - 1] : 0.0;
		const incStart = incTime && incTime.length > 0 ? incTime[0] : 0.0;
		const incEnd = incTime && incTime.length > 0 ? incTime[incTime.length - 1] : 0.0;
		const incDuration = Math.max(0.1, incEnd - incStart);
		const kInterLogGapSec = 1.0;

		const curRows = this._rowCount;
		const incRows = incoming.rowCount;
		const newTotalRows = curRows + incRows;

		const resMap = new Map<string, string>();
		for (const r of resolutions) {
			resMap.set(r.activeChannelName, r.incomingChannelName);
		}

		for (let i = 0; i < this._channels.length; ++i) {
			const actCh = this._channels[i];
			const isTimeCh =
				(this._timeChannelIndex !== undefined && this._timeChannelIndex === i) ||
				actCh.name === 'Time';

			let incVals: number[] = new Array(incRows).fill(NaN);
			const targetIncName = resMap.get(actCh.name);
			if (targetIncName && targetIncName !== '<NaN>') {
				const foundInc = incomingLookup.get(targetIncName);
				if (foundInc && foundInc.values.length === incRows) {
					incVals = foundInc.values;
				}
			}

			let combined: number[] = [];

			if (isTimeCh) {
				if (position === 'AppendToEnd') {
					combined = [...actCh.values];
					const timeBase = curEnd + kInterLogGapSec;
					for (let r = 0; r < incRows; ++r) {
						const rawT = incTime && r < incTime.length ? incTime[r] : r;
						combined.push(timeBase + (rawT - incStart));
					}
					this._stitchPoints.push(timeBase - kInterLogGapSec / 2.0);
				} else {
					const timeBase = 0.0;
					for (let r = 0; r < incRows; ++r) {
						const rawT = incTime && r < incTime.length ? incTime[r] : r;
						combined.push(timeBase + (rawT - incStart));
					}
					const curShift = incDuration + kInterLogGapSec - curStart;
					for (const t of actCh.values) {
						combined.push(t + curShift);
					}
					this._stitchPoints.push(curShift - kInterLogGapSec / 2.0);
				}
			} else {
				if (position === 'AppendToEnd') {
					combined = actCh.values.concat(incVals);
				} else {
					combined = incVals.concat(actCh.values);
				}
			}

			actCh.values = combined;
		}

		this._rowCount = newTotalRows;
		this._sourcePath += ` + ${incoming.sourcePath}`;
		this.resetCropRange();
		this.scanIntegrityAndBuildDiscontinuities();
		this._revision++;
		return { success: true };
	}
}
