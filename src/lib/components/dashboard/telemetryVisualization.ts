import type { PlotPoint, TelemetryResponse } from '../../shared/types/dashboard';
import type { ChannelSlot } from '../../shared/types/channelMapping';

export type ChartMode = 'combined' | 'stacked';
export type ChartView = { mode: ChartMode; cursor: number | null; hidden: ChannelSlot[] };

/** Mode and temporary curve visibility never change the caller's channel/window/row selection. */
export function changeChartMode(view: ChartView, mode: ChartMode): ChartView {
	return { ...view, mode };
}

export function toggleCurve(hidden: readonly ChannelSlot[], slot: ChannelSlot): ChannelSlot[] {
	return hidden.includes(slot) ? hidden.filter((s) => s !== slot) : [...hidden, slot];
}

export type ChannelScale = {
	min: number | null;
	max: number | null;
	count: number;
	flat: boolean;
	tolerance: number;
};

// Visualization guard only, not sensor accuracy or an analytical threshold.
export const FLAT_RELATIVE_TOLERANCE = 0.001;
export const FLAT_ABSOLUTE_TOLERANCE = 0.000001;

function inWindow(point: PlotPoint, start: number, end: number): boolean {
	return Number.isFinite(point.timeSec) && point.timeSec >= start && point.timeSec <= end;
}

export function visiblePoints(data: TelemetryResponse): PlotPoint[] {
	return data.segments.flatMap((segment) =>
		segment.filter((p) => inWindow(p, data.startSec, data.endSec))
	);
}

export function channelScale(data: TelemetryResponse, index: number): ChannelScale {
	let min = Infinity,
		max = -Infinity,
		count = 0;
	for (const segment of data.segments)
		for (const point of segment) {
			const value = point.values[index];
			if (
				!inWindow(point, data.startSec, data.endSec) ||
				typeof value !== 'number' ||
				!Number.isFinite(value)
			)
				continue;
			min = Math.min(min, value);
			max = Math.max(max, value);
			count++;
		}
	if (!count)
		return { min: null, max: null, count, flat: false, tolerance: FLAT_ABSOLUTE_TOLERANCE };
	const tolerance = Math.max(
		FLAT_ABSOLUTE_TOLERANCE,
		Math.max(Math.abs(min), Math.abs(max)) * FLAT_RELATIVE_TOLERANCE
	);
	return { min, max, count, flat: max - min <= tolerance, tolerance };
}

export function normalizedValue(
	value: number | null | undefined,
	scale: ChannelScale
): number | null {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		scale.min === null ||
		scale.max === null
	)
		return null;
	if (scale.flat) return 50;
	// Divide first to avoid overflow if finite extrema straddle very large magnitudes.
	const magnitude = Math.max(Math.abs(scale.min), Math.abs(scale.max)) || 1;
	return (
		100 *
		((value / magnitude - scale.min / magnitude) / (scale.max / magnitude - scale.min / magnitude))
	);
}

export type NormalizedPoint = { rowIndex: number; timeSec: number; percent: number };
/** Preserve server gap boundaries and break each channel independently at unusable samples. */
export function normalizedSegments(
	data: TelemetryResponse,
	index: number,
	scale: ChannelScale
): NormalizedPoint[][] {
	const result: NormalizedPoint[][] = [];
	for (const segment of data.segments) {
		let run: NormalizedPoint[] = [];
		let previousTime: number | null = null;
		for (const point of segment) {
			const percent = inWindow(point, data.startSec, data.endSec)
				? normalizedValue(point.values[index], scale)
				: null;
			if (percent === null) {
				run = [];
				previousTime = null;
				continue;
			}
			if (previousTime !== null && point.timeSec <= previousTime) run = [];
			if (!run.length) {
				run = [];
				result.push(run);
			}
			run.push({ rowIndex: point.rowIndex, timeSec: point.timeSec, percent });
			previousTime = point.timeSec;
		}
	}
	return result;
}

export function nearestPoint(points: readonly PlotPoint[], time: number): PlotPoint | null {
	let result: PlotPoint | null = null;
	for (const point of points)
		if (
			Number.isFinite(point.timeSec) &&
			(!result || Math.abs(point.timeSec - time) < Math.abs(result.timeSec - time))
		)
			result = point;
	return result;
}

export function cursorValues(data: TelemetryResponse, time: number | null) {
	const point = time === null ? null : nearestPoint(visiblePoints(data), time);
	return {
		point,
		channels: data.slots.map((slot, index) => {
			const resolution = data.resolutions[index];
			const value = point?.values[index];
			return {
				slot,
				value:
					resolution?.status === 'resolved' && typeof value === 'number' && Number.isFinite(value)
						? value
						: null,
				unit: resolution?.status === 'resolved' ? resolution.unit : null
			};
		})
	};
}

export function pointerTime(
	clientX: number,
	left: number,
	width: number,
	start: number,
	end: number
): number {
	return start + Math.max(0, Math.min(1, (clientX - left) / (width || 1))) * (end - start || 1);
}

/** Match the existing stacked chart's 0.8%-of-window drag threshold and nearest-row navigation. */
export function completedGesture(
	points: readonly PlotPoint[],
	anchor: number,
	end: number,
	span: number
) {
	return Math.abs(end - anchor) > span * 0.008
		? { kind: 'window' as const, start: Math.min(anchor, end), end: Math.max(anchor, end) }
		: { kind: 'sample' as const, point: nearestPoint(points, end) };
}

export function keyboardPoint(
	points: readonly PlotPoint[],
	cursor: number | null,
	start: number,
	key: string
): PlotPoint | null {
	if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(key)) return null;
	const current = nearestPoint(points, cursor ?? start);
	if (!current) return null;
	return points[
		Math.max(
			0,
			Math.min(
				points.length - 1,
				points.indexOf(current) + (key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0)
			)
		)
	];
}
