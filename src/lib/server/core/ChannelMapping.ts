import type {
	ChannelQuantity,
	ChannelResolution,
	ChannelSlot
} from '#lib/shared/types/channelMapping.ts';
import type { Channel } from './Channel';
import type { LogSession } from './LogSession';

type Definition = { label: string; quantity: ChannelQuantity; names: readonly string[] };
const definitions: Record<ChannelSlot, Definition> = {
	rpm: { label: 'RPM', quantity: 'engineSpeed', names: ['RPM', 'Filtered RPM', 'Engine Speed'] },
	load: {
		label: 'Manifold pressure (MAP)',
		quantity: 'manifoldPressure',
		names: ['MAP', 'Fuel - Load (MAP)', 'Manifold Pressure', 'Ignition - Load (MAP)']
	},
	afr: {
		label: 'AFR',
		quantity: 'airFuelRatio',
		names: ['AFR', 'AFR1', 'Wideband O2 1', 'Wideband O2 Overall']
	},
	lambda: {
		label: 'Lambda',
		quantity: 'lambda',
		names: ['WBC1 Lambda', 'Lambda1', 'Lambda', 'Wideband O2 1', 'Wideband O2 Overall']
	},
	tps: {
		label: 'Throttle (TPS)',
		quantity: 'throttlePosition',
		names: ['TPS', 'Throttle Position', 'Throttle Position - Cable']
	},
	tpsDot: {
		label: 'Throttle rate (TPSdot)',
		quantity: 'throttleRate',
		names: ['TPSdot', 'Throttle Position Derivative', 'Throttle Position Derivative - Cable']
	},
	mapDot: { label: 'Pressure rate (MAPdot)', quantity: 'pressureRate', names: ['MAPdot'] },
	clt: { label: 'Coolant (CLT)', quantity: 'temperature', names: ['CLT', 'Coolant Temperature'] },
	egt1: {
		label: 'Exhaust Temp (EGT1)',
		quantity: 'temperature',
		names: ['EGT1', 'Exhaust Gas Temperature 1']
	},
	egt2: {
		label: 'Exhaust Temp (EGT2)',
		quantity: 'temperature',
		names: ['EGT2', 'Exhaust Gas Temperature 2']
	},
	pw: { label: 'Pulse Width (PW)', quantity: 'pulseWidth', names: ['PW', 'Pulse Width'] },
	timing: {
		label: 'Ignition Timing',
		quantity: 'ignitionAdvance',
		names: ['SPK: Spark Advance', 'Ignition Timing']
	},
	mat: {
		label: 'Manifold Air Temperature',
		quantity: 'temperature',
		names: ['MAT', 'Intake Air Temperature', 'Manifold Air Temperature']
	},
	duty1: { label: 'Duty Cycle1', quantity: 'percentage', names: ['Duty Cycle1', 'Duty1'] },
	duty2: { label: 'Duty Cycle2', quantity: 'percentage', names: ['Duty Cycle2', 'Duty2'] },
	fan1duty: { label: 'Fan 1 Control Duty', quantity: 'percentage', names: ['Fan 1 control duty'] },
	fan2duty: { label: 'Fan 2 Control Duty', quantity: 'percentage', names: ['Fan 2 control duty'] },
	fuelwarmcor: {
		label: 'Fuel Warmup Correction',
		quantity: 'percentage',
		names: ['Fuel: Warmup cor']
	}
};
const slots = Object.keys(definitions) as ChannelSlot[];

type Conversion = {
	unit: string;
	scale: number;
	offset: number;
	basis: 'declared-unit' | 'project-map-default' | 'explicit-lambda-name';
};
function conversion(slot: ChannelSlot, channel: Channel): Conversion | undefined {
	const quantity = definitions[slot].quantity;
	const unit = channel.unit.trim().toLowerCase().replaceAll('°', '').replaceAll(' ', '');
	const result = (unit: string, scale = 1, offset = 0): Conversion => ({
		unit,
		scale,
		offset,
		basis: 'declared-unit'
	});
	// Known names from another quantity cannot be reinterpreted through a manual mapping.
	const knownQuantities = slots
		.filter((key) => definitions[key].names.includes(channel.name))
		.map((key) => definitions[key].quantity);
	if (knownQuantities.length && !knownQuantities.includes(quantity)) return;
	if (channel.name === 'Engine Demand') return;
	switch (quantity) {
		case 'engineSpeed':
			if (unit === 'rpm') return result('rpm');
			break;
		case 'manifoldPressure':
			if (!unit && definitions.load.names.includes(channel.name))
				return { ...result('kPa'), basis: 'project-map-default' };
			if (unit === 'kpa') return result('kPa');
			if (unit === 'pa') return result('kPa', 0.001);
			if (unit === 'bar') return result('kPa', 100);
			if (unit === 'mpa') return result('kPa', 1000);
			break;
		case 'airFuelRatio':
			if (unit === 'afr' || (unit === 'ratio' && /^AFR1?$/.test(channel.name)))
				return result('AFR');
			break;
		case 'lambda':
			if (
				unit === 'lambda' ||
				unit === 'λ' ||
				unit === '1' ||
				(unit === 'ratio' && /lambda/i.test(channel.name))
			)
				return result('lambda');
			if (!unit && /lambda/i.test(channel.name))
				return { ...result('lambda'), basis: 'explicit-lambda-name' };
			break;
		case 'throttlePosition':
		case 'percentage':
			if (unit === '%') return result('%');
			break;
		case 'throttleRate':
			if (unit === '%/s' || unit === '%/sec') return result('%/s');
			break;
		case 'pressureRate':
			if (unit === 'kpa/s' || unit === 'kpa/sec') return result('kPa/s');
			break;
		case 'temperature':
			if (unit === 'c' || unit === 'degc') return result('°C');
			if (unit === 'f' || unit === 'degf') return result('°C', 5 / 9, (-32 * 5) / 9);
			break;
		case 'pulseWidth':
			if (unit === 'ms') return result('ms');
			if (unit === 's') return result('ms', 1000);
			break;
		case 'ignitionAdvance':
			if (unit === 'deg') return result('deg');
			break;
	}
}

/** String slots identify source channels for compatibility. Analytical callers
 * must use resolve()/normalizedValue() to enforce quantity and unit compatibility.
 */
export class ChannelMapping {
	rpm = '';
	load = '';
	afr = '';
	lambda = '';
	tps = '';
	tpsDot = '';
	mapDot = '';
	clt = '';
	egt1 = '';
	egt2 = '';
	pw = '';
	timing = '';
	mat = '';
	duty1 = '';
	duty2 = '';
	fan1duty = '';
	fan2duty = '';
	fuelwarmcor = '';
	static readonly SLOTS = slots.map((slot) => definitions[slot].label);

	autoDetect(session: LogSession): void {
		for (const slot of slots) {
			const candidates = definitions[slot].names.filter((name) => session.findChannel(name));
			this[slot] =
				candidates.find((name) => {
					const channel = session.findChannel(name)!;
					return !channel.isBoolean && !channel.isTimestamp && conversion(slot, channel);
				}) ??
				candidates[0] ??
				'';
			// Generic wideband labels require units to disambiguate AFR from Lambda.
			if (
				(slot === 'afr' || slot === 'lambda') &&
				this[slot].startsWith('Wideband O2') &&
				!conversion(slot, session.findChannel(this[slot])!)
			)
				this[slot] = '';
		}
	}

	resolve(slot: ChannelSlot, session: LogSession): ChannelResolution {
		const base = { slot, quantity: definitions[slot].quantity };
		const channel = session.findChannel(this[slot]);
		if (!channel)
			return {
				...base,
				status: 'unavailable',
				reason: 'No mapped channel exists in this session.'
			};
		const source = { channelName: channel.name, sourceUnit: channel.unit };
		const units = conversion(slot, channel);
		if (!units || channel.isBoolean || channel.isTimestamp) {
			return {
				...base,
				...source,
				status: 'unresolved',
				reason: 'Channel quantity or unit is incompatible, ambiguous, or unsupported.'
			};
		}
		return { ...base, ...source, ...units, status: 'resolved' };
	}

	/** Missing, invalid and unresolved samples remain NaN; no implicit AFR/Lambda conversion. */
	normalizedValue(slot: ChannelSlot, session: LogSession, row: number): number {
		if (!Number.isInteger(row) || row < 0)
			throw new RangeError('Sample index must be a nonnegative integer.');
		const resolved = this.resolve(slot, session);
		if (resolved.status !== 'resolved') return NaN;
		const value = session.findChannel(resolved.channelName)!.values[row];
		if (!Number.isFinite(value)) return NaN;
		const normalized = value * resolved.scale + resolved.offset;
		return Number.isFinite(normalized) ? normalized : NaN;
	}

	toJSON(): Record<ChannelSlot, string> {
		return Object.fromEntries(slots.map((slot) => [slot, this[slot]])) as Record<
			ChannelSlot,
			string
		>;
	}

	/** Restored names are revalidated against a session by resolve(), never trusted as semantics. */
	static fromJSON(json: Record<string, string>): ChannelMapping {
		if (!json || typeof json !== 'object' || Array.isArray(json))
			throw new TypeError('Invalid channel mapping.');
		const mapping = new ChannelMapping();
		for (const [key, value] of Object.entries(json)) {
			if (!Object.hasOwn(definitions, key) || typeof value !== 'string')
				throw new TypeError('Unknown slot or invalid channel name.');
			mapping[key as ChannelSlot] = value;
		}
		return mapping;
	}
}
