import { describe, expect, it } from 'vitest';
import { Table2D, generateEvenBreakpoints } from '../src/lib/server/core/Table2D';

const example = () =>
	Table2D.fromJSON({
		xBreakpoints: [1000, 2000, 6000],
		yBreakpoints: [30, 100],
		values: [
			[10, 20, 60],
			[110, 120, 160]
		]
	});

describe('Table2D', () => {
	it.each([
		[2000, 100, 120],
		[4000, 65, 90],
		[7000, 65, 110],
		[500, 65, 60],
		[4000, 0, 40],
		[4000, 200, 140],
		[10000, 200, 160],
		[0, 0, 10]
	])('interpolates/clamps (%s, %s) to %s', (x, y, expected) => {
		expect(example().sample(x, y)).toBeCloseTo(expected);
	});

	it('handles single cells and single-axis tables', () => {
		const cell = new Table2D([1000], [30]);
		cell.setValue(0, 0, 14.7);
		expect(cell.sample(9000, 200)).toBe(14.7);
		const column = Table2D.fromJSON({
			xBreakpoints: [1000],
			yBreakpoints: [30, 100],
			values: [[10], [20]]
		});
		expect(column.sample(9000, 65)).toBe(15);
		const row = Table2D.fromJSON({
			xBreakpoints: [1000, 2000],
			yBreakpoints: [30],
			values: [[10, 20]]
		});
		expect(row.sample(1500, 200)).toBe(15);
	});

	it('keeps unavailability distinct from zero and ignores zero-weight missing neighbors', () => {
		expect(new Table2D().sample(1000, 30)).toBeNaN();
		const table = new Table2D([1000, 2000], [30, 100]);
		expect(table.value(0, 0)).toBeNaN();
		table.setValue(0, 0, 0);
		table.setValue(1, 1, 42);
		expect(table.sample(1000, 30)).toBe(0);
		expect(table.sample(3000, 200)).toBe(42);
		expect(table.sample(1500, 65)).toBeNaN();
	});

	it.each([NaN, Infinity, -Infinity])('rejects nonfinite queries %s', (value) => {
		expect(() => example().sample(value, 30)).toThrow(RangeError);
		expect(() => example().sample(1000, value)).toThrow(RangeError);
	});

	it.each([[2, 1], [1, 1], [NaN], [Infinity]].map((axis) => ({ axis })))(
		'rejects invalid axes %j atomically',
		({ axis }) => {
			expect(() => new Table2D(axis, [30])).toThrow(RangeError);
			expect(() => new Table2D([1000], axis)).toThrow(RangeError);
			const table = example();
			const before = table.toJSON();
			expect(() => table.setXBreakpoints(axis)).toThrow(RangeError);
			expect(() => table.setYBreakpoints(axis)).toThrow(RangeError);
			expect(table.toJSON()).toEqual(before);
			expect(() => Table2D.fromJSON({ xBreakpoints: axis, yBreakpoints: [], values: [] })).toThrow(
				RangeError
			);
		}
	);

	it('preserves cells by index when resizing and fills additions with NaN', () => {
		const table = example();
		table.setXBreakpoints([1000, 2000, 6000, 8000]);
		table.setYBreakpoints([30, 100, 200]);
		expect(table.value(1, 2)).toBe(160);
		expect(table.value(1, 3)).toBeNaN();
		expect(table.value(2, 0)).toBeNaN();
		table.setXBreakpoints([1000]);
		table.setYBreakpoints([30]);
		expect(table.values).toEqual([[10]]);
	});

	it.each([
		[-1, 0],
		[0, -1],
		[2, 0],
		[0, 3],
		[0.5, 0],
		[NaN, 0],
		[0, Infinity]
	])('rejects invalid indices (%s, %s)', (r, c) => {
		expect(() => example().value(r, c)).toThrow(RangeError);
		expect(() => example().setValue(r, c, 5)).toThrow(RangeError);
	});

	it('rejects infinite cell values but permits explicitly missing values', () => {
		const table = example();
		expect(() => table.setValue(0, 0, Infinity)).toThrow(RangeError);
		table.setValue(0, 0, NaN);
		expect(table.value(0, 0)).toBeNaN();
	});

	it('protects internal state from external mutations', () => {
		const x = [1000];
		const y = [30];
		const table = new Table2D(x, y);
		table.setValue(0, 0, 14);
		x[0] = 0;
		y[0] = 0;
		table.xBreakpoints[0] = 0;
		table.yBreakpoints.push(100);
		table.values[0][0] = 0;
		const data = table.toJSON();
		const restored = Table2D.fromJSON(data);
		data.values[0][0] = 0;
		expect(table.sample(1000, 30)).toBe(14);
		expect(restored.sample(1000, 30)).toBe(14);
		expect(table.xBreakpoints).toEqual([1000]);
		expect(table.yBreakpoints).toEqual([30]);
	});

	it('round-trips missing values through JSON as null', () => {
		const table = new Table2D([1000, 2000], [30]);
		table.setValue(0, 0, 0);
		const data = JSON.parse(JSON.stringify(table));
		expect(data.values).toEqual([[0, null]]);
		expect(Table2D.fromJSON(data).values).toEqual([[0, NaN]]);
	});

	it.each(
		[
			[],
			[[1]],
			[[1, 2, 3]],
			[
				[1, 2],
				[3, 4]
			],
			[[1, Infinity]],
			[[1, NaN]]
		].map((values) => ({ values }))
	)('rejects malformed matrix %j', ({ values }) => {
		expect(() =>
			Table2D.fromJSON({ xBreakpoints: [1000, 2000], yBreakpoints: [30], values })
		).toThrow();
	});

	it('resamples by interpolation and clamping', () => {
		expect(example().resampledTo([1000, 4000, 7000], [65]).values).toEqual([[60, 90, 110]]);
	});
});

describe('generateEvenBreakpoints', () => {
	it('supports zero, one, and multiple breakpoints', () => {
		expect(generateEvenBreakpoints(0, 10, 0)).toEqual([]);
		expect(generateEvenBreakpoints(2, 10, 1)).toEqual([2]);
		expect(generateEvenBreakpoints(0, 10, 3)).toEqual([0, 5, 10]);
	});
	it.each([
		[0, 10, -1],
		[0, 10, 2.5],
		[0, 10, NaN],
		[10, 0, 3],
		[1, 1, 2],
		[0, Infinity, 2]
	])('rejects invalid bounds/count %j', (min, max, count) => {
		expect(() => generateEvenBreakpoints(min, max, count)).toThrow(RangeError);
	});
});
