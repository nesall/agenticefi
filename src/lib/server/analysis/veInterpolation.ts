import type { VeLookup } from '../../shared/types/veEvaluation';
import { locateTableCoordinates } from './strictTableLookup';

/** Strict VE interpolation. Missing zero-weight corners remain visible but unused. */
export function interpolateVe(
	rpmAxis: readonly number[],
	mapAxisKpa: readonly number[],
	values: readonly (readonly (number | null)[])[],
	rpm: number,
	mapKpa: number
): VeLookup {
	if (values.length !== mapAxisKpa.length || values.some((row) => row.length !== rpmAxis.length))
		throw new Error('VE matrix dimensions do not match axes.');
	const location = locateTableCoordinates(rpmAxis, mapAxisKpa, rpm, mapKpa);
	if (location.status !== 'ok')
		return { location, status: 'coordinates-unavailable', value: null, corners: [] };
	const { rpmIndex: x, mapIndex: y, rpmFraction: fx, mapFraction: fy } = location.neighborhood;
	const corners = [
		{ rpmIndex: x, mapIndex: y, bilinearWeight: (1 - fx) * (1 - fy) },
		{ rpmIndex: x + 1, mapIndex: y, bilinearWeight: fx * (1 - fy) },
		{ rpmIndex: x, mapIndex: y + 1, bilinearWeight: (1 - fx) * fy },
		{ rpmIndex: x + 1, mapIndex: y + 1, bilinearWeight: fx * fy }
	].map((corner) => ({
		...corner,
		originalVe: Number.isFinite(values[corner.mapIndex][corner.rpmIndex])
			? values[corner.mapIndex][corner.rpmIndex]
			: null,
		relativeInfluence: null as number | null
	}));
	const used = corners.filter((c) => c.bilinearWeight > 0);
	if (used.some((c) => c.originalVe === null || !Number.isFinite(c.originalVe)))
		return { location, status: 'missing-ve', value: null, corners };
	if (used.some((c) => c.originalVe! <= 0))
		return { location, status: 'invalid-ve', value: null, corners };
	const value = used.reduce((sum, c) => sum + c.bilinearWeight * c.originalVe!, 0);
	if (!Number.isFinite(value) || value <= 0)
		return { location, status: 'nonfinite-ve', value: null, corners };
	for (const corner of corners)
		corner.relativeInfluence =
			corner.bilinearWeight === 0 ? 0 : (corner.bilinearWeight * corner.originalVe!) / value;
	return { location, status: 'available', value, corners };
}
