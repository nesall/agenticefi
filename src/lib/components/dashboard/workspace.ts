import type {
	DashboardAfrRegion,
	DashboardVeCell,
	SupportingSample
} from '../../shared/types/analyticalDashboard';
import type { InvestigationJob } from '../../shared/types/dashboard';

export type CellCoordinates = { rpmIndex: number; mapIndex: number };
export type VeAxes = { rpm: readonly number[]; mapKpa: readonly number[] };
export type GridCoordinate = CellCoordinates & {
	rpm: number;
	mapKpa: number;
	cell: DashboardVeCell | null;
};

/** Layout only. Missing evidence stays null; no interpolation or correction calculations. */
export function veGrid(cells: readonly DashboardVeCell[], axes?: VeAxes) {
	const x = axes
		? axes.rpm.map((value, index) => ({ index, value }))
		: [...new Map(cells.map((c) => [c.rpmIndex, c.rpm])).entries()].map(([index, value]) => ({
				index,
				value
			}));
	const y = axes
		? axes.mapKpa.map((value, index) => ({ index, value }))
		: [...new Map(cells.map((c) => [c.mapIndex, c.mapKpa])).entries()].map(([index, value]) => ({
				index,
				value
			}));
	x.sort((a, b) => a.index - b.index);
	y.sort((a, b) => b.index - a.index);
	const lookup = new Map(cells.map((c) => [`${c.rpmIndex}:${c.mapIndex}`, c]));
	return {
		x,
		y,
		rows: y.map((map) =>
			x.map((rpm): GridCoordinate => ({
				rpmIndex: rpm.index,
				mapIndex: map.index,
				rpm: rpm.value,
				mapKpa: map.value,
				cell: lookup.get(`${rpm.index}:${map.index}`) ?? null
			}))
		)
	};
}

/** Display-only crop. Context includes every original status and unavailable coordinate. */
export function focusedVeGrid(cells: readonly DashboardVeCell[], axes?: VeAxes) {
	const full = veGrid(cells, axes);
	const proposed = full.rows
		.flat()
		.filter(
			(p) =>
				p.cell?.status === 'accepted' &&
				Number.isFinite(p.cell.finalCorrectionPct) &&
				p.cell.finalCorrectionPct !== 0
		);
	if (!proposed.length)
		return {
			...full,
			x: [],
			y: [],
			rows: [],
			hidden: full.x.length * full.y.length,
			hasProposals: false
		};
	const xs = proposed.map((p) => full.x.findIndex((x) => x.index === p.rpmIndex));
	const ys = proposed.map((p) => full.y.findIndex((y) => y.index === p.mapIndex));
	const xStart = Math.max(0, Math.min(...xs) - 1),
		xEnd = Math.min(full.x.length, Math.max(...xs) + 2);
	const yStart = Math.max(0, Math.min(...ys) - 1),
		yEnd = Math.min(full.y.length, Math.max(...ys) + 2);
	const x = full.x.slice(xStart, xEnd),
		y = full.y.slice(yStart, yEnd);
	return {
		x,
		y,
		rows: full.rows.slice(yStart, yEnd).map((row) => row.slice(xStart, xEnd)),
		hidden: full.x.length * full.y.length - x.length * y.length,
		hasProposals: true
	};
}

/** Representative adjacent-region rows, not a claim about exact material cell influence. */
export function neighboringSamples(
	regions: readonly DashboardAfrRegion[],
	selected: CellCoordinates
): SupportingSample[] {
	return [
		...new Map(
			regions
				.filter(
					(r) =>
						(r.rpmIndex === selected.rpmIndex || r.rpmIndex + 1 === selected.rpmIndex) &&
						(r.mapIndex === selected.mapIndex || r.mapIndex + 1 === selected.mapIndex)
				)
				.flatMap((r) => r.samples)
				.map((s) => [s.rowIndex, s])
		).values()
	];
}

export function shouldRevealResults(
	job: InvestigationJob,
	wasRunning: boolean,
	runNavigationVersion: number,
	currentNavigationVersion: number
): boolean {
	return (
		wasRunning &&
		job.state === 'finished' &&
		job.mode === 'analytical' &&
		runNavigationVersion === currentNavigationVersion
	);
}
