import { describe, expect, it } from 'vitest';
import { Channel } from '../src/lib/server/core/Channel';
import { LogSession } from '../src/lib/server/core/LogSession';
import {
	classifySampleEligibility as classify,
	DEFAULT_ELIGIBILITY_CONFIG
} from '../src/lib/server/analysis/sampleEligibility';
import type { EligibilityConfig } from '../src/lib/shared/types/sampleEligibility';

function session(
	changes: Record<string, { unit?: string; values?: number[] } | null> = {},
	times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]
): LogSession {
	const n = times.length;
	const defaults: Record<string, { unit: string; values: number[] }> = {
		Time: { unit: 's', values: times },
		RPM: { unit: 'rpm', values: Array(n).fill(2000) },
		MAP: { unit: 'kPa', values: Array(n).fill(50) },
		AFR: { unit: 'AFR', values: Array(n).fill(14) },
		CLT: { unit: '°C', values: Array(n).fill(85) },
		'Fuel: Warmup cor': { unit: '%', values: Array(n).fill(100) },
		TPS: { unit: '%', values: Array(n).fill(10) },
		TPSdot: { unit: '%/s', values: Array(n).fill(0) },
		MAPdot: { unit: 'kPa/s', values: Array(n).fill(0) },
		PW: { unit: 'ms', values: Array(n).fill(3) }
	};
	const result = new LogSession();
	result.rowCount = n;
	for (const [name, original] of Object.entries(defaults)) {
		if (changes[name] === null) continue;
		const channel = { ...original, ...changes[name] };
		result.addChannel(new Channel(name, channel.unit, channel.values));
		if (name === 'Time') result.setTimeChannelIndex(result.channels.length - 1);
	}
	result.channelMapping.autoDetect(result);
	return result;
}
const codes = (result: ReturnType<typeof classify>, row: number) =>
	result.samples[row].reasons.map((reason) => reason.code);
const instant: Partial<EligibilityConfig> = { steadyWindowSec: 0 };

describe('deterministic sample eligibility', () => {
	it('does not treat overflowing time intervals as valid derivative or gap evidence', () => {
		const result = classify(session({}, [-1e308, 1e308]), instant);
		expect(codes(result, 1)).toContain('TIME_INTERVAL_UNUSABLE');
		expect(codes(result, 1)).toContain('RPM_TRANSIENT_UNASSESSED');
		expect(result.samples[1].status).toBe('indeterminate');
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
	it('requires a contiguous steady window and partitions every sample', () => {
		const result = classify(session());
		expect(result.samples[0].status).toBe('indeterminate');
		expect(result.samples[1].status).toBe('heuristic-excluded');
		expect(result.samples[5].status).toBe('eligible');
		expect(result.summary.statuses).toEqual({
			'hard-excluded': 0,
			'heuristic-excluded': 4,
			indeterminate: 1,
			eligible: 2
		});
		expect(Object.values(result.summary.statuses).reduce((a, b) => a + b, 0)).toBe(7);
	});
	it.each(['RPM', 'MAP', 'AFR'] as const)('hard-excludes missing core channel %s', (name) => {
		const result = classify(session({ [name]: null }));
		expect(result.samples.every((sample) => sample.status === 'hard-excluded')).toBe(true);
		expect(result.samples[2].reasons.some((reason) => reason.category === 'hard')).toBe(true);
	});
	it.each([0, -1, NaN, Infinity])('hard-excludes invalid core values %s', (value) => {
		for (const name of ['RPM', 'MAP', 'AFR']) {
			const result = classify(
				session({ [name]: { values: [2000, value, 2000, 2000, 2000, 2000, 2000] } }),
				instant
			);
			expect(result.samples[1].status).toBe('hard-excluded');
		}
	});
	it('does not substitute Lambda for AFR or unsupported pressure units for MAP', () => {
		const c = session({ AFR: null, MAP: { unit: 'psi' } });
		c.addChannel(new Channel('Lambda1', 'lambda', Array(7).fill(1)));
		c.channelMapping.autoDetect(c);
		const result = classify(c);
		expect(codes(result, 2)).toContain('AFR_UNUSABLE');
		expect(codes(result, 2)).toContain('LOAD_UNUSABLE');
	});
	it('keeps unavailable enabled checks indeterminate rather than assuming warm and steady', () => {
		const result = classify(session({ CLT: null }), instant);
		expect(result.samples[2].status).toBe('indeterminate');
		expect(codes(result, 2)).toContain('COOLANT_BELOW_MINIMUM_UNASSESSED');
		expect(
			classify(session({ CLT: null }), { ...instant, minCoolantC: null }).samples[2].status
		).toBe('eligible');
	});
	it('checks normalized Fahrenheit coolant and explicit warmup correction deviation', () => {
		const result = classify(
			session({
				CLT: { unit: '°F', values: Array(7).fill(140) },
				'Fuel: Warmup cor': { values: Array(7).fill(110) }
			}),
			instant
		);
		expect(result.samples[2].status).toBe('heuristic-excluded');
		expect(result.samples[2].reasons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'COOLANT_BELOW_MINIMUM',
					category: 'heuristic',
					evidence: [expect.objectContaining({ value: expect.closeTo(60), unit: '°C' })]
				}),
				expect.objectContaining({
					code: 'WARMUP_CORRECTION_ACTIVE',
					evidence: [
						expect.objectContaining({ value: 10, sourceValue: 110, method: 'absolute-deviation' })
					]
				})
			])
		);
	});
	it('accepts equality at configurable thresholds', () => {
		const c = session({
			CLT: { values: Array(7).fill(70) },
			'Fuel: Warmup cor': { values: Array(7).fill(101) },
			TPSdot: { values: Array(7).fill(-5) },
			MAPdot: { values: Array(7).fill(10) }
		});
		expect(classify(c, instant).samples[2].status).toBe('eligible');
	});
	it.each([
		['TPSdot', -6, 'TPS_TRANSIENT'],
		['MAPdot', 11, 'MAP_TRANSIENT']
	] as const)('uses absolute logged rates for %s', (name, value, code) => {
		const result = classify(session({ [name]: { values: Array(7).fill(value) } }), instant);
		expect(codes(result, 2)).toContain(code);
		expect(
			result.samples[2].reasons.find((reason) => reason.code === code)!.evidence[0].method
		).toBe('logged-rate');
	});
	it('checks finite differences even when the logged derivative claims zero', () => {
		const result = classify(session({ TPS: { values: [10, 10, 20, 20, 20, 20, 20] } }), instant);
		const reason = result.samples[2].reasons.find((reason) => reason.code === 'TPS_TRANSIENT')!;
		expect(reason.evidence).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					method: 'finite-difference',
					value: 40,
					sourceValue: 20,
					previousValue: 10,
					deltaSec: 0.25
				})
			])
		);
	});
	it('derives rates from actual channels when logged rates are absent', () => {
		const result = classify(
			session({
				TPSdot: null,
				MAPdot: null,
				RPM: { values: [2000, 2000, 2100, 2100, 2100, 2100, 2100] }
			}),
			instant
		);
		expect(result.samples[1].status).toBe('eligible');
		expect(codes(result, 2)).toContain('RPM_TRANSIENT');
		expect(
			result.samples[2].reasons.find((reason) => reason.code === 'RPM_TRANSIENT')!.evidence[0].value
		).toBe(400);
	});
	it('does not compute derivatives across gaps or missing core samples', () => {
		const c = session({ TPSdot: null, MAPdot: null }, [0, 0.25, 2, 2.25, 2.5, 2.75, 3]);
		const result = classify(c, instant);
		expect(codes(result, 2)).toContain('TIME_GAP');
		expect(codes(result, 2)).toContain('RPM_TRANSIENT_UNASSESSED');
		const invalid = classify(session({ AFR: { values: [14, NaN, 14, 14, 14, 14, 14] } }), instant);
		expect(codes(invalid, 2)).toContain('RPM_TRANSIENT_UNASSESSED');
	});
	it('hard-excludes invalid, duplicate and reversed times and protects the prior high-water mark', () => {
		const result = classify(session({}, [0, 0.25, 0.25, 0.1, 0.2, NaN, 1]));
		for (const row of [2, 3, 4, 5]) expect(result.samples[row].status).toBe('hard-excluded');
		expect(codes(result, 4)).toContain('TIME_NOT_INCREASING');
	});
	it('hard-excludes missing/unsupported time units', () => {
		for (const c of [session({ Time: null }), session({ Time: { unit: 'ms' } })])
			expect(classify(c).samples.every((sample) => sample.status === 'hard-excluded')).toBe(true);
	});
	it('hard-excludes stitch boundaries and restarts the steady window', () => {
		const c = session(
			{},
			Array.from({ length: 15 }, (_, i) => i * 0.25)
		);
		c.discontinuities.push({
			cause: 'StitchPoint',
			rowIndex: 6,
			timeSec: 1.5,
			durationSec: 0.25,
			label: 'known seam'
		});
		const result = classify(c);
		expect(result.samples[5].status).toBe('eligible');
		expect(codes(result, 6)).toContain('STITCH_BOUNDARY');
		expect(result.samples[7].status).not.toBe('eligible');
		expect(result.samples[12].status).toBe('eligible');
	});
	it('labels possible fuel cut only when PW/RPM/TPS telemetry jointly supports it', () => {
		const cut = classify(
			session({ PW: { values: Array(7).fill(0) }, TPS: { values: Array(7).fill(1) } }),
			instant
		);
		expect(codes(cut, 2)).toContain('POSSIBLE_FUEL_CUT');
		const stopped = classify(
			session({
				PW: { values: Array(7).fill(0) },
				RPM: { values: Array(7).fill(0) },
				TPS: { values: Array(7).fill(1) }
			}),
			instant
		);
		expect(codes(stopped, 2)).not.toContain('POSSIBLE_FUEL_CUT');
		expect(stopped.samples[2].status).toBe('hard-excluded');
		const missing = classify(session({ PW: null }), instant);
		expect(codes(missing, 2)).toContain('FUEL_CUT_UNASSESSED');
		expect(missing.samples[2].status).toBe('indeterminate');
		const lean = classify(session({ AFR: { values: Array(7).fill(25) } }), instant);
		expect(codes(lean, 2)).not.toContain('POSSIBLE_FUEL_CUT');
	});
	it('disables heuristics explicitly without disabling hard exclusions', () => {
		const profile = {
			minCoolantC: null,
			maxWarmupCorrectionDeviationPct: null,
			maxAbsTpsRatePctPerSec: null,
			maxAbsMapRateKpaPerSec: null,
			maxAbsRpmRatePerSec: null,
			maxGapSec: null,
			steadyWindowSec: 0,
			possibleFuelCutMaxPulseWidthMs: null
		};
		const result = classify(session({ CLT: null, TPS: null, PW: null }), profile);
		expect(result.samples.every((sample) => sample.status === 'eligible')).toBe(true);
		expect(
			classify(session({ AFR: null }), profile).samples.every(
				(sample) => sample.status === 'hard-excluded'
			)
		).toBe(true);
	});
	it('is deterministic, serializable, and does not mutate samples or defaults', () => {
		const c = session();
		const before = c.channels.map((ch) => [...ch.values]);
		const a = classify(c);
		expect(classify(c)).toEqual(a);
		expect(c.channels.map((ch) => ch.values)).toEqual(before);
		expect(a.config).not.toBe(DEFAULT_ELIGIBILITY_CONFIG);
		expect(JSON.parse(JSON.stringify(a))).toEqual(a);
	});
	it.each([
		{ maxGapSec: 0 },
		{ minCoolantC: NaN },
		{ steadyWindowSec: -1 },
		{ possibleFuelCutMinRpm: null },
		{ maxAbsTpsRatePctPerSec: Infinity },
		{ unknown: 1 }
	])('rejects invalid profile %#', (config) => {
		expect(() => classify(session(), config as Partial<EligibilityConfig>)).toThrow();
	});
});
