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
