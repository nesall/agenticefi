import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';
import { MegasquirtCsvParser } from '../src/lib/server/msl/MegasquirtCsvParser';
import {
	classifySampleEligibility as classify,
	DEFAULT_ELIGIBILITY_CONFIG as defaults
} from '../src/lib/server/analysis/sampleEligibility';

describe('representative real-log eligibility', () => {
	it.each([
		['2025-04-12_16.16.28.msl', 2859],
		['2026-07-25_17.56.47.msl', 18990],
		['2026-08-01_09.45.13.msl', 29650]
	] as const)(
		'screens %s without inventing missing evidence',
		(file, rowCount) => {
			const decoded = decodeMsl(readFileSync(new URL(`./fixtures/msl/${file}`, import.meta.url)));
			const { session } = new MegasquirtCsvParser().parse(decoded.content, file);
			expect(session).not.toBeNull();
			const result = classify(session!);
			expect(result.samples).toHaveLength(rowCount);
			expect(Object.values(result.summary.statuses).reduce((a, b) => a + b, 0)).toBe(rowCount);
			expect(result.summary.statuses.eligible).toBeGreaterThan(0);
			const rpm = session!.findChannel('RPM')!.values;
			const clt = session!.findChannel('CLT')!.values;
			const warmup = session!.findChannel('Fuel: Warmup cor')!.values;
			let engineStopped = 0,
				warmupActive = 0;
			for (let row = 0; row < rowCount; row++) {
				const sample = result.samples[row];
				if (rpm[row] === 0) {
					engineStopped++;
					expect(sample.status).toBe('hard-excluded');
				}
				if (Math.abs(warmup[row] - 100) > defaults.maxWarmupCorrectionDeviationPct!) {
					warmupActive++;
					expect(sample.reasons.some((reason) => reason.code === 'WARMUP_CORRECTION_ACTIVE')).toBe(
						true
					);
				}
				if (sample.status === 'eligible') {
					expect(Object.values(sample.checks).every((state) => state === 'pass')).toBe(true);
					expect(((clt[row] - 32) * 5) / 9).toBeGreaterThanOrEqual(defaults.minCoolantC!);
					expect(Math.abs(warmup[row] - 100)).toBeLessThanOrEqual(
						defaults.maxWarmupCorrectionDeviationPct!
					);
					expect(Math.abs(session!.findChannel('TPSdot')!.values[row])).toBeLessThanOrEqual(
						defaults.maxAbsTpsRatePctPerSec!
					);
					expect(Math.abs(session!.findChannel('MAPdot')!.values[row])).toBeLessThanOrEqual(
						defaults.maxAbsMapRateKpaPerSec!
					);
				}
			}
			if (file.startsWith('2026-08')) {
				expect(engineStopped).toBe(338);
				expect(warmupActive).toBeGreaterThan(0);
			} else {
				expect(engineStopped).toBe(0);
				expect(warmupActive).toBe(0);
				expect(result.summary.reasonCounts.POSSIBLE_FUEL_CUT ?? 0).toBe(0);
			}
			console.info(
				'Eligibility screening:',
				JSON.stringify({
					file,
					profile: result.config,
					statuses: result.summary.statuses,
					reasons: result.summary.reasonCounts
				})
			);
		},
		20000
	);
});
