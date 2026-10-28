import type { TelemetryResponse } from '../src/lib/shared/types/dashboard';

export function telemetryFixture(): TelemetryResponse {
	return {
		sessionId: 'test',
		startSec: 0,
		endSec: 2,
		pointCount: 3,
		invalidTimeCount: 0,
		slots: ['rpm', 'load', 'afr', 'tps'],
		resolutions: [
			{
				slot: 'rpm',
				quantity: 'engineSpeed',
				channelName: 'RPM',
				sourceUnit: 'rpm',
				unit: 'rpm',
				scale: 1,
				offset: 0,
				basis: 'declared-unit',
				status: 'resolved'
			},
			{
				slot: 'load',
				quantity: 'manifoldPressure',
				channelName: 'MAP',
				sourceUnit: 'kPa',
				unit: 'kPa',
				scale: 1,
				offset: 0,
				basis: 'declared-unit',
				status: 'resolved'
			},
			{
				slot: 'afr',
				quantity: 'airFuelRatio',
				channelName: 'AFR',
				sourceUnit: 'AFR',
				unit: 'AFR',
				scale: 1,
				offset: 0,
				basis: 'declared-unit',
				status: 'resolved'
			},
			{
				slot: 'tps',
				quantity: 'throttlePosition',
				channelName: 'TPS',
				sourceUnit: '%',
				unit: '%',
				scale: 1,
				offset: 0,
				basis: 'declared-unit',
				status: 'resolved'
			}
		],
		segments: [
			[
				{ rowIndex: 10, timeSec: 0, values: [800, 40, 12, 5], status: 'eligible' },
				{ rowIndex: 11, timeSec: 1, values: [1800, 60, 14, 15], status: 'eligible' },
				{ rowIndex: 12, timeSec: 2, values: [2800, 80, 16, 25], status: 'eligible' }
			]
		]
	};
}
