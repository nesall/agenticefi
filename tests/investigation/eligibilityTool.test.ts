import { describe, expect, it } from 'vitest';
import { executeInvestigationTool as execute } from '../../src/lib/server/investigation/tools';
import {
	classifySampleEligibility,
	summarizeEligibility
} from '../../src/lib/server/analysis/sampleEligibility';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import type { JsonValue } from '../../src/lib/shared/types/investigation';
import { context, scripted, tool, final } from './helpers';

describe('sample-eligibility analytical tool', () => {
	it('exposes caller thresholds, audit counts, unavailable checks, and structured evidence', () => {
		const c = context();
		const result = execute(c, 'assess_sample_eligibility', {
			startSec: 0,
			endSec: 2,
			maxSamples: 2
		});
		expect(result).toMatchObject({
			ok: true,
			data: {
				config: { minCoolantC: 70 },
				summary: { rowCount: 3 },
				samples: [{ rowIndex: 0 }, { rowIndex: 1 }],
				omittedSampleDetails: 1
			}
		});
		if (result.ok)
			expect(JSON.stringify(result.data)).toContain('COOLANT_BELOW_MINIMUM_UNASSESSED');
	});
	it('classifies preceding history before selecting a window', () => {
		const c = context();
		const full = classifySampleEligibility(c.session, c.eligibilityProfile);
		expect(execute(c, 'assess_sample_eligibility', { startSec: 1, endSec: 2 })).toMatchObject({
			ok: true,
			data: { summary: summarizeEligibility(full.samples.slice(1)) }
		});
	});
	it.each([
		{},
		{ startSec: 2, endSec: 1 },
		{ startSec: 0, endSec: 1, config: { minCoolantC: null } },
		{ startSec: 0, endSec: 1, maxSamples: 21 },
		{ startSec: 0, endSec: 1, maxSamples: 1.5 },
		{ startSec: NaN, endSec: 1 }
	])('rejects invalid arguments or model threshold overrides %#', (args) => {
		expect(execute(context(), 'assess_sample_eligibility', args).ok).toBe(false);
	});
	it('bounds detail output while preserving full counts', () => {
		const rows = Array.from({ length: 1000 }, (_, i) => `${i * 0.1}\t0\tbad\tbad`);
		const c = context(rows);
		const result = execute(c, 'assess_sample_eligibility', {
			startSec: 0,
			endSec: 100,
			maxSamples: 20
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const data = result.data as Record<string, JsonValue>;
		const samples = data.samples as JsonValue[];
		expect(samples.length).toBeLessThanOrEqual(20);
		expect(data.omittedSampleDetails).toBe(1000 - samples.length);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64000);
	});
	it('supports an agent tool call and evidence citation through the existing runner', async () => {
		const result = await runInvestigation(
			context(),
			scripted(tool('assess_sample_eligibility', { startSec: 0, endSec: 2 }), final()),
			{ goal: 'Assess eligibility under the configured profile.' }
		);
		expect(result.status).toBe('completed');
		expect(result.trace[0].tool).toBe('assess_sample_eligibility');
	});
});
