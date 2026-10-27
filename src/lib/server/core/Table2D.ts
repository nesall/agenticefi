export function generateEvenBreakpoints(
	minValue: number,
	maxValue: number,
	count: number
): number[] {
	if (
		!Number.isInteger(count) ||
		count < 0 ||
		!Number.isFinite(minValue) ||
		!Number.isFinite(maxValue)
	) {
		throw new RangeError('Count must be a nonnegative integer and bounds must be finite.');
	}
	if (count > 1 && maxValue <= minValue) throw new RangeError('Bounds must increase.');
	if (count === 0) return [];
	if (count === 1) return [minValue];
	return Array.from(
		{ length: count },
		(_, i) => minValue + ((maxValue - minValue) * i) / (count - 1)
	);
}

type TableData = {
	xBreakpoints: number[];
	yBreakpoints: number[];
	values: (number | null)[][];
};

/** Row-major calibration table: values[load row][RPM column]. */
export class Table2D {
	private _xBreakpoints: number[];
	private _yBreakpoints: number[];
	private _values: number[][] = [];

	constructor(xBreakpoints: number[] = [], yBreakpoints: number[] = []) {
		Table2D.validateAxis(xBreakpoints);
		Table2D.validateAxis(yBreakpoints);
		this._xBreakpoints = [...xBreakpoints];
		this._yBreakpoints = [...yBreakpoints];
		this.ensureValuesSized();
	}

	private static validateAxis(axis: number[]): void {
		if (!Array.isArray(axis)) throw new TypeError('Breakpoints must be an array.');
		for (let i = 0; i < axis.length; i++) {
			if (!Number.isFinite(axis[i]) || (i > 0 && axis[i] <= axis[i - 1])) {
				throw new RangeError('Breakpoints must be finite and strictly increasing.');
			}
		}
	}

	get xBreakpoints(): number[] {
		return [...this._xBreakpoints];
	}
	get yBreakpoints(): number[] {
		return [...this._yBreakpoints];
	}
	get values(): number[][] {
		return this._values.map((row) => [...row]);
	}
	get columnCount(): number {
		return this._xBreakpoints.length;
	}
	get rowCount(): number {
		return this._yBreakpoints.length;
	}

	/** Preserve existing cells by index; use resampledTo() to preserve the lookup surface. */
	setXBreakpoints(breakpoints: number[]): void {
		Table2D.validateAxis(breakpoints);
		this._xBreakpoints = [...breakpoints];
		this.ensureValuesSized();
	}
	setYBreakpoints(breakpoints: number[]): void {
		Table2D.validateAxis(breakpoints);
		this._yBreakpoints = [...breakpoints];
		this.ensureValuesSized();
	}

	private validateIndex(row: number, col: number): void {
		if (
			!Number.isInteger(row) ||
			!Number.isInteger(col) ||
			row < 0 ||
			row >= this.rowCount ||
			col < 0 ||
			col >= this.columnCount
		) {
			throw new RangeError('Cell index is outside the table.');
		}
	}
	value(row: number, col: number): number {
		this.validateIndex(row, col);
		return this._values[row][col];
	}
	setValue(row: number, col: number, newValue: number): void {
		this.validateIndex(row, col);
		if (typeof newValue !== 'number' || (!Number.isFinite(newValue) && !Number.isNaN(newValue))) {
			throw new RangeError('Cells must be finite numbers or NaN for unavailable data.');
		}
		this._values[row][col] = newValue;
	}

	private ensureValuesSized(): void {
		this._values.length = Math.min(this._values.length, this.rowCount);
		while (this._values.length < this.rowCount) this._values.push([]);
		for (const row of this._values) {
			row.length = Math.min(row.length, this.columnCount);
			while (row.length < this.columnCount) row.push(NaN);
		}
	}

	private static locate(axis: number[], query: number): { lowIndex: number; frac: number } {
		if (axis.length === 1 || query <= axis[0]) return { lowIndex: 0, frac: 0 };
		if (query >= axis[axis.length - 1]) return { lowIndex: axis.length - 2, frac: 1 };
		let low = 0;
		let high = axis.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (axis[mid] <= query) low = mid + 1;
			else high = mid;
		}
		return { lowIndex: low - 1, frac: (query - axis[low - 1]) / (axis[low] - axis[low - 1]) };
	}

	/** Bilinear interpolation, clamping both axes to the nearest edge. */
	sample(x: number, y: number): number {
		if (!Number.isFinite(x) || !Number.isFinite(y))
			throw new RangeError('Lookup coordinates must be finite.');
		if (!this.columnCount || !this.rowCount) return NaN;
		const { lowIndex: c, frac: fx } = Table2D.locate(this._xBreakpoints, x);
		const { lowIndex: r, frac: fy } = Table2D.locate(this._yBreakpoints, y);
		const ch = Math.min(c + 1, this.columnCount - 1);
		const rh = Math.min(r + 1, this.rowCount - 1);
		// Missing neighbors with zero weight do not invalidate an exact cell or edge.
		const lerp = (a: number, b: number, f: number): number =>
			f === 0 ? a : f === 1 ? b : a + (b - a) * f;
		return lerp(
			lerp(this.value(r, c), this.value(r, ch), fx),
			lerp(this.value(rh, c), this.value(rh, ch), fx),
			fy
		);
	}

	resampledTo(xBreakpoints: number[], yBreakpoints: number[]): Table2D {
		const result = new Table2D(xBreakpoints, yBreakpoints);
		for (let r = 0; r < result.rowCount; r++) {
			for (let c = 0; c < result.columnCount; c++)
				result.setValue(r, c, this.sample(xBreakpoints[c], yBreakpoints[r]));
		}
		return result;
	}

	/** JSON represents unavailable cells explicitly as null. */
	toJSON(): TableData {
		return {
			xBreakpoints: this.xBreakpoints,
			yBreakpoints: this.yBreakpoints,
			values: this._values.map((row) => row.map((value) => (Number.isNaN(value) ? null : value)))
		};
	}
	static fromJSON(data: TableData): Table2D {
		if (!data || typeof data !== 'object') throw new TypeError('Invalid table data.');
		Table2D.validateAxis(data.xBreakpoints);
		Table2D.validateAxis(data.yBreakpoints);
		const table = new Table2D(data.xBreakpoints, data.yBreakpoints);
		if (!Array.isArray(data.values) || data.values.length !== table.rowCount)
			throw new RangeError('Row count does not match Y axis.');
		for (let r = 0; r < table.rowCount; r++) {
			const row = data.values[r];
			if (!Array.isArray(row) || row.length !== table.columnCount)
				throw new RangeError('Column count does not match X axis.');
			for (let c = 0; c < table.columnCount; c++) {
				const value = row[c];
				if (value !== null && !Number.isFinite(value))
					throw new TypeError('JSON cells must be finite numbers or null.');
				table.setValue(r, c, value === null ? NaN : value);
			}
		}
		return table;
	}
}
