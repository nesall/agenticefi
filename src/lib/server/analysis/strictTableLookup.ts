import type { Table2D } from '../core/Table2D';
import type { CoordinateLookup, TableLookup } from '../../shared/types/targetAfrError';

export function validateAnalysisAxes(rpmAxis: readonly number[], mapAxis: readonly number[]) {
	for (const axis of [rpmAxis, mapAxis]) {
		if (axis.length < 2 || axis.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= axis[i - 1])))
			throw new Error(
				'Analysis tables require at least two finite, strictly increasing breakpoints per axis.'
			);
	}
}

/** Inclusive outer bounds; an internal knot belongs to the interval above it. */
export function locateTableCoordinates(
	rpmAxis: readonly number[],
	mapAxis: readonly number[],
	rpm: number,
	mapKpa: number
): CoordinateLookup {
	validateAnalysisAxes(rpmAxis, mapAxis);
	const coordinates = {
		rpm: Number.isFinite(rpm) ? rpm : null,
		mapKpa: Number.isFinite(mapKpa) ? mapKpa : null
	};
	const missingAxes = (['rpm', 'mapKpa'] as const).filter((axis) => coordinates[axis] === null);
	if (missingAxes.length) return { ...coordinates, status: 'missing-input', missingAxes };
	const outsideAxes: Extract<CoordinateLookup, { status: 'out-of-bounds' }>['outsideAxes'] = [];
	for (const [axis, values, value] of [
		['rpm', rpmAxis, rpm],
		['mapKpa', mapAxis, mapKpa]
	] as const) {
		if (value < values[0] || value > values.at(-1)!)
			outsideAxes.push({ axis, value, bounds: [values[0], values.at(-1)!] });
	}
	if (outsideAxes.length) return { ...coordinates, status: 'out-of-bounds', outsideAxes };
	const locate = (axis: readonly number[], value: number) => {
		let index = 0;
		while (index < axis.length - 2 && value >= axis[index + 1]) index++;
		const span = axis[index + 1] - axis[index];
		const fraction = Number.isFinite(span)
			? (value - axis[index]) / span
			: (value / 2 - axis[index] / 2) / (axis[index + 1] / 2 - axis[index] / 2);
		return { index, fraction };
	};
	const x = locate(rpmAxis, rpm),
		y = locate(mapAxis, mapKpa);
	return {
		...coordinates,
		status: 'ok',
		neighborhood: {
			rpmIndex: x.index,
			mapIndex: y.index,
			rpmBounds: [rpmAxis[x.index], rpmAxis[x.index + 1]],
			mapBoundsKpa: [mapAxis[y.index], mapAxis[y.index + 1]],
			rpmFraction: x.fraction,
			mapFraction: y.fraction
		}
	};
}

/** Strict AFR lookup. Does not use or change Table2D's existing clamping API. */
export function lookupTargetAfr(table: Table2D, rpm: number, mapKpa: number): TableLookup {
	const location = locateTableCoordinates(table.xBreakpoints, table.yBreakpoints, rpm, mapKpa);
	if (location.status !== 'ok')
		return { ...location, value: null, corners: [], valueStatus: 'not-looked-up' };
	const { rpmIndex: x, mapIndex: y, rpmFraction: fx, mapFraction: fy } = location.neighborhood;
	const corners = [
		{ rpmIndex: x, mapIndex: y, weight: (1 - fx) * (1 - fy) },
		{ rpmIndex: x + 1, mapIndex: y, weight: fx * (1 - fy) },
		{ rpmIndex: x, mapIndex: y + 1, weight: (1 - fx) * fy },
		{ rpmIndex: x + 1, mapIndex: y + 1, weight: fx * fy }
	].map((corner) => ({
		...corner,
		value: Number.isFinite(table.value(corner.mapIndex, corner.rpmIndex))
			? table.value(corner.mapIndex, corner.rpmIndex)
			: null
	}));
	const used = corners.filter((corner) => corner.weight > 0);
	if (used.some((corner) => corner.value === null))
		return { ...location, value: null, corners, valueStatus: 'missing-cells' };
	if (used.some((corner) => corner.value! <= 0))
		return { ...location, value: null, corners, valueStatus: 'invalid-target-afr' };
	const value = used.reduce((sum, corner) => sum + corner.weight * corner.value!, 0);
	return {
		...location,
		value: Number.isFinite(value) ? value : null,
		corners,
		valueStatus: Number.isFinite(value) ? 'available' : 'nonfinite-result'
	};
}
