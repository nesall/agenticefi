export type ChannelQuantity =
	| 'engineSpeed'
	| 'manifoldPressure'
	| 'airFuelRatio'
	| 'lambda'
	| 'throttlePosition'
	| 'throttleRate'
	| 'pressureRate'
	| 'temperature'
	| 'pulseWidth'
	| 'ignitionAdvance'
	| 'percentage';

export type ChannelSlot =
	| 'rpm'
	| 'load'
	| 'afr'
	| 'lambda'
	| 'tps'
	| 'tpsDot'
	| 'mapDot'
	| 'clt'
	| 'egt1'
	| 'egt2'
	| 'pw'
	| 'timing'
	| 'mat'
	| 'duty1'
	| 'duty2'
	| 'fan1duty'
	| 'fan2duty'
	| 'fuelwarmcor';

/** Only a resolved mapping is suitable for numerical analysis. Original units
 * remain visible; normalizedValue = rawValue * scale + offset.
 */
export type ChannelResolution = {
	slot: ChannelSlot;
	quantity: ChannelQuantity;
} & (
	| { status: 'unavailable'; reason: string }
	| { status: 'unresolved'; channelName: string; sourceUnit: string; reason: string }
	| {
			status: 'resolved';
			channelName: string;
			sourceUnit: string;
			unit: string;
			scale: number;
			offset: number;
			basis: 'declared-unit' | 'project-map-default' | 'explicit-lambda-name';
	  }
);
