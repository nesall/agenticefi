import type { EligibilityStatus } from '../../shared/types/sampleEligibility';
import type { ChannelSlot } from '../../shared/types/channelMapping';

export const statusLabels: Record<EligibilityStatus, string> = {
	eligible: 'Passes screening',
	'hard-excluded': 'Hard exclusion',
	'heuristic-excluded': 'Heuristic exclusion',
	indeterminate: 'Indeterminate'
};
export const statusColors: Record<EligibilityStatus, string> = {
	eligible: 'var(--color-success-500)',
	'hard-excluded': 'var(--color-error-500)',
	'heuristic-excluded': 'var(--color-warning-500)',
	indeterminate: 'var(--color-tertiary-500)'
};
export const channelLabels: Partial<Record<ChannelSlot, string>> = {
	rpm: 'Engine speed',
	load: 'Manifold pressure',
	afr: 'Measured AFR',
	tps: 'Throttle position',
	clt: 'Coolant',
	tpsDot: 'Throttle rate',
	mapDot: 'Pressure rate',
	pw: 'Pulse width'
};
export const channelColors: Partial<Record<ChannelSlot, string>> = {
	rpm: 'var(--color-primary-500)',
	load: 'var(--color-secondary-500)',
	afr: 'var(--color-success-500)',
	tps: 'var(--color-warning-500)',
	clt: 'var(--color-error-500)',
	tpsDot: 'var(--color-tertiary-500)',
	mapDot: 'var(--color-secondary-500)',
	pw: 'var(--color-warning-500)'
};
export const number = (value: number | null | undefined, digits = 2) =>
	value == null || !Number.isFinite(value)
		? '—'
		: new Intl.NumberFormat('en-US', {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits
			}).format(value);
