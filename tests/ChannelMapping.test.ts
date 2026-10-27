import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Channel } from '../src/lib/server/core/Channel';
import { ChannelMapping } from '../src/lib/server/core/ChannelMapping';
import { LogSession } from '../src/lib/server/core/LogSession';
import { MegasquirtCsvParser } from '../src/lib/server/msl/MegasquirtCsvParser';
import type { ChannelSlot } from '../src/lib/shared/types/channelMapping';

function create(...channels: [string, string, number[]?][]): LogSession {
	const session = new LogSession();
	for (const [name, unit, values = [1]] of channels)
		session.addChannel(new Channel(name, unit, values));
	session.channelMapping.autoDetect(session);
	return session;
}

describe('ChannelMapping quantity resolution', () => {
	it('starts unavailable, including pulse width', () => {
		const session = create();
		expect(session.channelMapping.pw).toBe('');
		for (const slot of Object.keys(session.channelMapping.toJSON()) as ChannelSlot[]) {
			expect(session.channelMapping.resolve(slot, session).status).toBe('unavailable');
		}
	});

	it('keeps AFR, Lambda, MAP, TPS and their derivatives separate', () => {
		const session = create(
			['AFR', 'AFR', [14.7]],
			['Lambda1', 'lambda', [1]],
			['MAP', 'kPa', [100]],
			['TPS', '%', [25]],
			['TPSdot', '%/s', [2]],
			['MAPdot', 'kPa/s', [3]]
		);
		const mapping = session.channelMapping;
		expect([
			mapping.afr,
			mapping.lambda,
			mapping.load,
			mapping.tps,
			mapping.tpsDot,
			mapping.mapDot
		]).toEqual(['AFR', 'Lambda1', 'MAP', 'TPS', 'TPSdot', 'MAPdot']);
		expect(mapping.resolve('afr', session)).toMatchObject({
			status: 'resolved',
			quantity: 'airFuelRatio',
			unit: 'AFR'
		});
		expect(mapping.resolve('lambda', session)).toMatchObject({
			status: 'resolved',
			quantity: 'lambda',
			unit: 'lambda'
		});
	});

	it('does not substitute Lambda, TPS, Engine Demand or MAPdot for incompatible quantities', () => {
		const session = create(
			['Lambda1', 'lambda'],
			['TPS', '%'],
			['Engine Demand', '%'],
			['MAPdot', 'kPa/s']
		);
		expect(session.channelMapping.afr).toBe('');
		expect(session.channelMapping.load).toBe('');
		expect(session.channelMapping.tpsDot).toBe('');
		expect(session.channelMapping.resolve('lambda', session).status).toBe('resolved');
	});

	it.each([
		['AFR', 'afr', 'lambda'],
		['lambda', 'lambda', 'afr']
	] as const)('resolves generic wideband units %s only to %s', (unit, expected, other) => {
		const session = create(['Wideband O2 1', unit]);
		expect(session.channelMapping[expected]).toBe('Wideband O2 1');
		expect(session.channelMapping[other]).toBe('');
	});

	it.each(['', 'ratio', 'volts'])(
		'leaves generic wideband %j unresolved rather than guessing',
		(unit) => {
			const session = create(['Wideband O2 1', unit]);
			expect(session.channelMapping.afr).toBe('');
			expect(session.channelMapping.lambda).toBe('');
		}
	);

	it('prefers a compatible alias over a contradictory first candidate', () => {
		const session = create(['AFR', 'lambda'], ['AFR1', 'AFR']);
		expect(session.channelMapping.afr).toBe('AFR1');
	});

	it('rechecks manual/restored mappings and rejects incompatible known names', () => {
		const session = create(['Lambda1', 'AFR'], ['TPS', 'kPa']);
		const mapping = ChannelMapping.fromJSON({ afr: 'Lambda1', load: 'TPS', pw: 'missing' });
		expect(mapping.resolve('afr', session).status).toBe('unresolved');
		expect(mapping.resolve('load', session).status).toBe('unresolved');
		expect(mapping.resolve('pw', session).status).toBe('unavailable');
	});

	it('does not infer units for arbitrary manually selected channels', () => {
		const session = create(['Custom Load', '']);
		const mapping = ChannelMapping.fromJSON({ load: 'Custom Load' });
		expect(mapping.resolve('load', session).status).toBe('unresolved');
	});

	it('detects pulse width only when present and clears stale mappings on redetection', () => {
		const mapping = create(['PW', 'ms']).channelMapping;
		expect(mapping.pw).toBe('PW');
		mapping.autoDetect(create());
		expect(mapping.pw).toBe('');
	});
});

describe('normalized channel values', () => {
	it.each([
		['load', 'MAP', 'kPa', 100, 100, 'kPa'],
		['load', 'MAP', 'bar', 1.5, 150, 'kPa'],
		['load', 'MAP', 'Pa', 100000, 100, 'kPa'],
		['load', 'MAP', 'MPa', 0.1, 100, 'kPa'],
		['clt', 'CLT', '°F', 212, 100, '°C'],
		['clt', 'CLT', '°C', 90, 90, '°C'],
		['pw', 'PW', 's', 0.002, 2, 'ms'],
		['rpm', 'RPM', ' RPM ', 1500, 1500, 'rpm'],
		['tpsDot', 'TPSdot', '%/sec', 2, 2, '%/s'],
		['mapDot', 'MAPdot', 'kPa/sec', 3, 3, 'kPa/s']
	] as const)('normalizes %s from %s (%s)', (slot, name, unit, value, expected, normalizedUnit) => {
		const session = create([name, unit, [value]]);
		expect(session.channelMapping.normalizedValue(slot, session, 0)).toBeCloseTo(expected);
		expect(session.channelMapping.resolve(slot, session)).toMatchObject({
			status: 'resolved',
			sourceUnit: unit,
			unit: normalizedUnit,
			basis: 'declared-unit'
		});
		expect(session.findChannel(name)!.values).toEqual([value]);
	});

	it('applies the project MAP default only when no unit is declared', () => {
		const session = create(['MAP', '', [90]]);
		expect(session.channelMapping.resolve('load', session)).toMatchObject({
			status: 'resolved',
			unit: 'kPa',
			basis: 'project-map-default'
		});
		expect(session.channelMapping.normalizedValue('load', session, 0)).toBe(90);
		expect(
			create(['MAP', 'psi']).channelMapping.resolve('load', create(['MAP', 'psi'])).status
		).toBe('unresolved');
	});

	it('can interpret an explicit unitless Lambda name without converting it to AFR', () => {
		const session = create(['Lambda1', '', [0.9]]);
		expect(session.channelMapping.resolve('lambda', session)).toMatchObject({
			status: 'resolved',
			basis: 'explicit-lambda-name'
		});
		expect(session.channelMapping.normalizedValue('lambda', session, 0)).toBe(0.9);
		expect(session.channelMapping.normalizedValue('afr', session, 0)).toBeNaN();
	});

	it.each([
		['AFR', 'lambda', 'afr'],
		['CLT', '�F', 'clt'],
		['TPSdot', 'kPa/s', 'tpsDot'],
		['RPM', '', 'rpm']
	] as const)('rejects unsupported/contradictory %s unit %s', (name, unit, slot) => {
		const session = create([name, unit]);
		expect(session.channelMapping.resolve(slot, session).status).toBe('unresolved');
		expect(session.channelMapping.normalizedValue(slot, session, 0)).toBeNaN();
	});

	it('preserves missing and invalid samples rather than converting them to zero', () => {
		const session = create(['MAP', 'kPa', [0, NaN, Infinity]]);
		expect(session.channelMapping.normalizedValue('load', session, 0)).toBe(0);
		for (const row of [1, 2, 3])
			expect(session.channelMapping.normalizedValue('load', session, row)).toBeNaN();
		expect(() => session.channelMapping.normalizedValue('load', session, -1)).toThrow(RangeError);
	});

	it('does not use boolean or timestamp channels for numeric telemetry', () => {
		const session = create(['MAP', 'kPa']);
		session.findChannel('MAP')!.setIsBoolean(true);
		expect(session.channelMapping.resolve('load', session).status).toBe('unresolved');
		session.findChannel('MAP')!.setIsBoolean(false);
		session.findChannel('MAP')!.setIsTimestamp(true);
		expect(session.channelMapping.resolve('load', session).status).toBe('unresolved');
	});

	it('round-trips known slots and rejects unknown keys instead of assigning methods', () => {
		const mapping = create(['MAP', 'kPa']).channelMapping;
		expect(ChannelMapping.fromJSON(JSON.parse(JSON.stringify(mapping))).toJSON()).toEqual(
			mapping.toJSON()
		);
		expect(() => ChannelMapping.fromJSON({ toJSON: 'bad' })).toThrow(TypeError);
	});

	it('resolves real-log quantities and exposes corrupt temperature units', () => {
		const content = readFileSync(
			new URL('./fixtures/msl/2025-04-12_16.16.28.msl', import.meta.url),
			'utf8'
		);
		const { session } = new MegasquirtCsvParser().parse(content);
		expect(session).not.toBeNull();
		for (const slot of ['rpm', 'load', 'afr', 'tps', 'tpsDot', 'mapDot', 'pw'] as const) {
			expect(session!.channelMapping.resolve(slot, session!).status, slot).toBe('resolved');
		}
		expect(session!.channelMapping.lambda).toBe('');
		expect(session!.channelMapping.resolve('clt', session!).status).toBe('unresolved');
	});
});
