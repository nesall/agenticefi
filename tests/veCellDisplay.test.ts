import { describe, expect, it } from 'vitest';
import {
	veCorrectionLabel,
	evaluatedUnchanged,
	veCellExplanation
} from '../src/lib/components/dashboard/veCellDisplay';
import type { DashboardVeCell } from '../src/lib/shared/types/analyticalDashboard';

const cell: DashboardVeCell = {
	rpmIndex: 0,
	mapIndex: 0,
	rpm: 1000,
	mapKpa: 50,
	status: 'accepted',
	reasons: [],
	finalCorrectionPct: 0,
	atBound: false,
	materialTrainingSamples: 100,
	originalVe: 40,
	proposedVe: 40
};

describe('VE correction display without changing stored values', () => {
	it.each([
		[0, '0%'],
		[-0, '0%'],
		[1.234567, '+1.235%'],
		[-1.234567, '-1.235%'],
		[0.00001, '+0.000%'],
		[-0.00001, '-0.000%'],
		[0.0005, '+0.001%'],
		['0', '—'],
		['0.0', '—'],
		['-0', '—'],
		['1.25', '—'],
		[null, '—'],
		[undefined, '—'],
		[NaN, '—'],
		[Infinity, '—']
	])('formats %s as %s with no extra zero or suppression symbol', (value, expected) => {
		expect(veCorrectionLabel(value)).toBe(expected);
	});
	it('distinguishes exact zero, near-zero, suppressed, unsupported, missing and malformed data', () => {
		for (const delta of [0, -0]) {
			expect(evaluatedUnchanged({ ...cell, finalCorrectionPct: delta })).toBe(true);
			expect(veCellExplanation({ ...cell, finalCorrectionPct: delta })).toContain(
				'accepted exact-zero'
			);
		}
		const near = { ...cell, finalCorrectionPct: -0.00001 };
		expect(evaluatedUnchanged(near)).toBe(false);
		expect(veCellExplanation(near)).toContain('-0.00001%');
		expect(veCellExplanation(near)).toContain('not an exact-zero');
		expect(near.finalCorrectionPct).toBe(-0.00001);
		for (const status of ['suppressed', 'unsupported'] as const)
			expect(evaluatedUnchanged({ ...cell, status })).toBe(false);
		expect(veCellExplanation({ ...cell, status: 'suppressed' })).toContain('proposal withheld');
		expect(veCellExplanation({ ...cell, status: 'unsupported' })).toContain('Unsupported');
		expect(veCellExplanation(null)).toContain('Unavailable');
		expect(evaluatedUnchanged({ ...cell, finalCorrectionPct: '0' as unknown as number })).toBe(
			false
		);
	});
});
