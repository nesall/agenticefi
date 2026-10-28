import { describe, expect, it } from 'vitest';
import {
	channelScale,
	normalizedValue,
	normalizedSegments,
	cursorValues,
	changeChartMode,
	toggleCurve,
	visiblePoints,
	pointerTime,
	completedGesture,
	keyboardPoint,
	type ChartView
} from '../src/lib/components/dashboard/telemetryVisualization';
import { telemetryFixture } from './telemetryFixtures';

describe('telemetry display normalization', () => {
	it('normalizes different physical scales independently without mutating data', () => {
		const data = telemetryFixture(),
			copy = structuredClone(data);
		for (let index = 0; index < data.slots.length; index++) {
			const scale = channelScale(data, index);
			data.segments[0].forEach((point, i) =>
				expect(normalizedValue(point.values[index], scale)).toBeCloseTo(i * 50, 10)
			);
		}
		expect(data).toEqual(copy);
	});
	it.each([
		[0, 0, 0],
		[1000, 1000.2, 1000.5],
		[0, 0.00000001, 0.00000002],
		[-10, -10.001, -10.002]
	])(
		'keeps constant/near-flat signals visible without amplifying their variation: %j',
		(...values) => {
			const data = telemetryFixture();
			data.segments[0].forEach((p, i) => (p.values[0] = values[i]));
			const scale = channelScale(data, 0);
			expect(scale.flat).toBe(true);
			expect(data.segments[0].map((p) => normalizedValue(p.values[0], scale))).toEqual([
				50, 50, 50
			]);
			expect(cursorValues(data, 1).channels[0].value).toBe(values[1]);
		}
	);
	it('does not flatten variation beyond the documented guard', () => {
		const data = telemetryFixture();
		data.segments[0].forEach((p, i) => (p.values[0] = 1000 + i));
		expect(channelScale(data, 0).flat).toBe(false);
	});
	it('ignores missing/nonfinite values in extrema and breaks curves independently', () => {
		const data = telemetryFixture();
		data.endSec = 8;
		data.segments = [
			Array.from({ length: 9 }, (_, i) => ({
				rowIndex: i,
				timeSec: i,
				values: [i % 2 === 0 ? i : [null, NaN, Infinity, -Infinity][(i - 1) / 2], 40],
				status: 'eligible' as const
			}))
		];
		const scale = channelScale(data, 0);
		expect(scale.count).toBe(5);
		expect([scale.min, scale.max]).toEqual([0, 8]);
		expect(normalizedSegments(data, 0, scale).map((s) => s.length)).toEqual([1, 1, 1, 1, 1]);
		expect(normalizedSegments(data, 1, channelScale(data, 1))).toHaveLength(1);
		for (const value of [null, undefined, NaN, Infinity, -Infinity])
			expect(normalizedValue(value, scale)).toBeNull();
		data.segments[0].forEach((p) => (p.values = []));
		expect(channelScale(data, 0).count).toBe(0);
		expect(normalizedSegments(data, 0, channelScale(data, 0))).toEqual([]);
	});
	it('preserves server gaps and splits at invalid or non-increasing time', () => {
		const data = telemetryFixture();
		data.segments = [data.segments[0].slice(0, 2), data.segments[0].slice(2)];
		expect(
			normalizedSegments(data, 0, channelScale(data, 0)).map((s) => s.map((p) => p.rowIndex))
		).toEqual([[10, 11], [12]]);
		data.segments = [
			[
				...data.segments[0],
				{ rowIndex: 99, timeSec: NaN, values: [9], status: 'eligible' },
				...data.segments[1]
			]
		];
		expect(normalizedSegments(data, 0, channelScale(data, 0)).map((s) => s.length)).toEqual([2, 1]);
		data.segments = [
			[...data.segments[0], { rowIndex: 100, timeSec: 1, values: [5], status: 'eligible' }]
		];
		expect(normalizedSegments(data, 0, channelScale(data, 0)).map((s) => s.length)).toEqual([
			2, 1, 1
		]);
	});
	it('recomputes extrema for the visible window and never joins across out-of-window rows', () => {
		const data = telemetryFixture();
		data.startSec = 1;
		const scale = channelScale(data, 0);
		expect([scale.min, scale.max]).toEqual([1800, 2800]);
		expect(normalizedValue(1800, scale)).toBe(0);
		expect(visiblePoints(data).map((p) => p.rowIndex)).toEqual([11, 12]);
		data.startSec = 3;
		data.endSec = 4;
		expect(channelScale(data, 0).min).toBeNull();
		expect(normalizedSegments(data, 0, channelScale(data, 0))).toEqual([]);
	});
	it('handles large finite extrema without overflow in normalization', () => {
		const scale = { min: -1e308, max: 1e308, count: 2, flat: false, tolerance: 1e305 };
		expect(normalizedValue(0, scale)).toBe(50);
	});
});

describe('chart view and engineering navigation', () => {
	it('retains the cursor and temporary visibility across both mode switches', () => {
		const view: ChartView = { mode: 'combined', cursor: 1.25, hidden: ['load'] };
		const stacked = changeChartMode(view, 'stacked');
		expect(stacked).toEqual({ ...view, mode: 'stacked' });
		expect(changeChartMode(stacked, 'combined')).toEqual(view);
		expect(view.mode).toBe('combined');
	});
	it('toggles temporary curve visibility without mutating selected channels', () => {
		const data = telemetryFixture(),
			selected = [...data.slots];
		const hidden = toggleCurve([], 'rpm');
		expect(hidden).toEqual(['rpm']);
		expect(toggleCurve(hidden, 'rpm')).toEqual([]);
		expect(data.slots).toEqual(selected);
		expect(hidden).toEqual(['rpm']);
	});
	it('reports physical values and canonical units from one actual cursor row', () => {
		const data = telemetryFixture(),
			readout = cursorValues(data, 1.1);
		expect(readout.point?.rowIndex).toBe(11);
		expect(readout.channels.map((c) => [c.value, c.unit])).toEqual([
			[1800, 'rpm'],
			[60, 'kPa'],
			[14, 'AFR'],
			[15, '%']
		]);
		data.segments[0][1].values[2] = NaN;
		expect(cursorValues(data, 1).channels[2].value).toBeNull();
		data.resolutions[0] = {
			slot: 'rpm',
			quantity: 'engineSpeed',
			status: 'unavailable',
			reason: 'missing'
		};
		expect(cursorValues(data, 1).channels[0]).toMatchObject({ value: null, unit: null });
		expect(cursorValues(data, null).point).toBeNull();
	});
	it('matches stacked click-vs-drag semantics and retains original evidence row indices', () => {
		const points = visiblePoints(telemetryFixture());
		expect(pointerTime(50, 0, 100, 0, 2)).toBe(1);
		expect(pointerTime(-50, 0, 100, 0, 2)).toBe(0);
		expect(pointerTime(150, 0, 100, 0, 2)).toBe(2);
		expect(completedGesture(points, 1, 1.005, 2)).toEqual({ kind: 'sample', point: points[1] });
		expect(completedGesture(points, 1.8, 0.2, 2)).toEqual({ kind: 'window', start: 0.2, end: 1.8 });
		expect(keyboardPoint(points, 1, 0, 'ArrowRight')?.rowIndex).toBe(12);
		expect(keyboardPoint(points, 1, 0, 'ArrowLeft')?.rowIndex).toBe(10);
		expect(keyboardPoint(points, 1, 0, 'Enter')?.rowIndex).toBe(11);
		expect(keyboardPoint(points, 2, 0, 'ArrowRight')?.rowIndex).toBe(12);
		expect(keyboardPoint([], null, 0, 'Enter')).toBeNull();
		expect(keyboardPoint(points, 1, 0, 'Escape')).toBeNull();
	});
});
