import type { DashboardVeCell } from '../../shared/types/analyticalDashboard';
import { number } from './presentation';

/** Display only: exact numeric zero includes -0; strings/missing values are not coerced. */
export function veCorrectionLabel(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
	if (value === 0) return '0%';
	return `${value > 0 ? '+' : ''}${number(value, 3)}%`;
}

export function evaluatedUnchanged(cell: DashboardVeCell | null): boolean {
	return cell?.status === 'accepted' && cell.finalCorrectionPct === 0;
}

/** Explain finalized status without relabeling suppressed proposals as accepted decisions. */
export function veCellExplanation(cell: DashboardVeCell | null): string {
	if (!cell) return 'Unavailable: this cell decision was not retained.';
	if (cell.status === 'unsupported')
		return 'Unsupported: no correction proposed; unchanged where original calibration is available.';
	if (cell.status === 'suppressed')
		return 'Suppressed: proposal withheld; finalized candidate remains unchanged. See suppression reasons.';
	if (evaluatedUnchanged(cell)) return 'Evaluated, unchanged: accepted exact-zero correction (0%).';
	const delta = cell.finalCorrectionPct;
	if (typeof delta !== 'number' || !Number.isFinite(delta))
		return 'Accepted decision has an unavailable correction value.';
	return `Accepted nonzero correction: ${delta > 0 ? '+' : ''}${String(delta)}%.${Math.abs(delta) < 0.0005 ? ' Display rounds to three decimals; this is not an exact-zero decision.' : ''}`;
}
