import { describe, expect, it } from 'vitest';
import {
	veGrid,
	focusedVeGrid,
	neighboringSamples,
	shouldRevealResults
} from '../src/lib/components/dashboard/workspace';
import type {
	DashboardVeCell,
	DashboardAfrRegion,
	SupportingSample
} from '../src/lib/shared/types/analyticalDashboard';
import type { InvestigationJob } from '../src/lib/shared/types/dashboard';

const cell: DashboardVeCell = {
	rpmIndex: 1,
	mapIndex: 1,
	rpm: 1300,
	mapKpa: 45,
	status: 'suppressed',
	reasons: ['INSUFFICIENT_EPISODES'],
	finalCorrectionPct: 0,
	atBound: false,
	materialTrainingSamples: 7,
	originalVe: 100.1234567,
	proposedVe: 100.1234567
};

describe('dashboard workspace layout and navigation', () => {
	it('keeps zero decisions within context without letting zero or negative-zero expand Focused bounds', () => {
		const axes = { rpm: [800, 1000, 1500, 2300, 4000], mapKpa: [20, 40, 60, 90, 120] };
		const nonzero = { ...cell, status: 'accepted' as const, finalCorrectionPct: 0.00001 };
		const inside = { ...cell, status: 'accepted' as const, rpmIndex: 2, finalCorrectionPct: 0 };
		const far = {
			...cell,
			status: 'accepted' as const,
			rpmIndex: 4,
			mapIndex: 4,
			finalCorrectionPct: -0
		};
		const grid = focusedVeGrid([nonzero, inside, far], axes);
		expect(grid.x.map((p) => p.index)).toEqual([0, 1, 2]);
		expect(grid.y.map((p) => p.index)).toEqual([2, 1, 0]);
		expect(grid.rows.flat().find((p) => p.cell === inside)).toBeDefined();
		expect(grid.rows.flat().find((p) => p.cell === far)).toBeUndefined();
		expect(grid.rows.flat().find((p) => p.cell === nonzero)?.cell?.finalCorrectionPct).toBe(
			0.00001
		);
	});
	it('focuses accepted nonzero proposals with bounded context, preserving original cell references', () => {
		const axes = { rpm: [800, 1000, 1500, 2300, 4000], mapKpa: [20, 40, 60, 90, 120] };
		const accepted = {
			...cell,
			rpmIndex: 2,
			mapIndex: 2,
			status: 'accepted' as const,
			finalCorrectionPct: -3
		};
		const grid = focusedVeGrid([accepted, cell], axes);
		expect(grid.x.map((x) => x.index)).toEqual([1, 2, 3]);
		expect(grid.y.map((y) => y.index)).toEqual([3, 2, 1]);
		expect(grid.hidden).toBe(16);
		expect(grid.rows.flat().find((p) => p.cell === accepted)?.rpmIndex).toBe(2);
		expect(grid.rows.flat().find((p) => p.cell === cell)?.cell?.status).toBe('suppressed');
		expect(grid.rows.flat().filter((p) => !p.cell)).toHaveLength(7);
		const corners = focusedVeGrid(
			[
				{ ...accepted, rpmIndex: 0, mapIndex: 0 },
				{ ...accepted, rpmIndex: 4, mapIndex: 4 }
			],
			axes
		);
		expect(corners.hidden).toBe(0);
		expect(corners.rows.flat()).toHaveLength(25);
	});
	it('does not focus zeros, nonfinite deltas, suppressed, unsupported or absent decisions', () => {
		const axes = { rpm: [800, 1300], mapKpa: [20, 45] };
		for (const cells of [
			[],
			[cell],
			[{ ...cell, status: 'unsupported' as const }],
			[{ ...cell, status: 'accepted' as const }],
			[{ ...cell, status: 'accepted' as const, finalCorrectionPct: NaN }]
		]) {
			expect(focusedVeGrid(cells, axes)).toMatchObject({
				hasProposals: false,
				hidden: 4,
				rows: []
			});
			expect(veGrid(cells, axes).rows.flat()).toHaveLength(4);
		}
	});
	it('projects original nonuniform axes without inventing missing cell decisions', () => {
		const axes = { rpm: [800, 1300, 2200], mapKpa: [20, 45, 100] };
		const grid = veGrid([cell], axes);
		expect(grid.x.map((x) => x.value)).toEqual(axes.rpm);
		expect(grid.y.map((y) => y.value)).toEqual([100, 45, 20]);
		expect(grid.rows.flat().filter((p) => p.cell === null)).toHaveLength(8);
		expect(grid.rows[1][1].cell).toBe(cell);
		expect(grid.rows[1][1].cell?.originalVe).toBe(100.1234567);
		expect(axes.mapKpa).toEqual([20, 45, 100]);
	});
	it('shows all 256 actual coordinates for partial recordings, preserving unavailable evidence', () => {
		const axes = {
			rpm: Array.from({ length: 16 }, (_, i) => 800 + i * 400),
			mapKpa: Array.from({ length: 16 }, (_, i) => 20 + i * 10)
		};
		const grid = veGrid([], axes);
		expect(grid.rows.flat()).toHaveLength(256);
		expect(grid.rows.flat().every((p) => p.cell === null)).toBe(true);
	});
	it('uses only retained coordinates if an older presentation lacks axes', () => {
		const grid = veGrid([cell]);
		expect(grid.rows.flat()).toHaveLength(1);
		expect(grid.rows[0][0].cell).toBe(cell);
	});
	it('links representative adjacent neighborhoods by coordinates and deduplicates actual rows', () => {
		const sample: SupportingSample = {
			rowIndex: 15,
			timeSec: 1.5,
			rpm: 1300,
			mapKpa: 45,
			measuredAfr: 14,
			targetAfr: 14.7
		};
		const region = (rpmIndex: number, mapIndex: number, samples: SupportingSample[]) =>
			({ rpmIndex, mapIndex, samples }) as DashboardAfrRegion;
		const regions = [
			region(0, 0, [sample]),
			region(1, 1, [sample]),
			region(2, 2, [{ ...sample, rowIndex: 99 }])
		];
		expect(neighboringSamples(regions, cell)).toEqual([sample]);
		expect(neighboringSamples(regions, { rpmIndex: 8, mapIndex: 8 })).toEqual([]);
	});
	it('auto-reveals only a newly finished analytical run without intervening workspace navigation', () => {
		const finished = { state: 'finished', mode: 'analytical' } as InvestigationJob;
		expect(shouldRevealResults(finished, true, 2, 2)).toBe(true);
		expect(shouldRevealResults(finished, true, 2, 4)).toBe(false);
		expect(shouldRevealResults(finished, false, 2, 2)).toBe(false);
		expect(shouldRevealResults({ ...finished, state: 'running' }, true, 2, 2)).toBe(false);
		expect(shouldRevealResults({ ...finished, mode: 'legacy' }, true, 2, 2)).toBe(false);
	});
});
