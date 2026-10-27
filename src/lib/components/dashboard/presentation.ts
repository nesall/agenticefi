import type { EligibilityStatus } from '../../shared/types/sampleEligibility';
import type { ChannelSlot } from '../../shared/types/channelMapping';

export const statusLabels: Record<EligibilityStatus, string> = {
	eligible: 'Passes screening',
	'hard-excluded': 'Hard exclusion',
	'heuristic-excluded': 'Heuristic exclusion',
	indeterminate: 'Indeterminate'
};
export const statusColors: Record<EligibilityStatus, string> = {
	eligible: '#55cbb0',
	'hard-excluded': '#ef8295',
	'heuristic-excluded': '#edb56a',
	indeterminate: '#9d9dbb'
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
	rpm: '#81a9f5',
	load: '#c2a0ef',
	afr: '#66d3b6',
	tps: '#edb56a',
	clt: '#ed8d9e',
	tpsDot: '#d9b4e9',
	mapDot: '#8dc6da',
	pw: '#b9cf8a'
};
export const number = (value: number | null | undefined, digits = 2) =>
	value == null || !Number.isFinite(value)
		? '—'
		: new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
