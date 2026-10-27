import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadInvestigationFiles } from '../../src/lib/server/investigation/context';
import { runInvestigation } from '../../src/lib/server/investigation/runner';
import type {
	InvestigationModel,
	JsonValue,
	ToolTraceEntry
} from '../../src/lib/shared/types/investigation';
import { tool } from './helpers';

function data(entry: ToolTraceEntry): Record<string, JsonValue> {
	if (
		!entry.result.ok ||
		!entry.result.data ||
		typeof entry.result.data !== 'object' ||
		Array.isArray(entry.result.data)
	)
		throw new Error('Expected tool data.');
	return entry.result.data;
}

/** Scripted decisions test the protocol. This is not a live Muse Spark run.
 * The substitute only sees tool results; it does not receive the raw log.
 */
const model: InvestigationModel = {
	async next({ trace }) {
		if (!trace.length) return tool('describe_log');
		if (trace.length === 1) {
			const time = data(trace[0]).time as Record<string, JsonValue>;
			if (typeof time.startSec !== 'number' || typeof time.endSec !== 'number')
				throw new Error('No usable time bounds.');
			return tool('summarize_window', {
				startSec: time.startSec,
				endSec: Math.min(time.endSec, time.startSec + 60),
				slots: ['rpm', 'load', 'afr', 'clt']
			});
		}
		if (trace.length === 2) return tool('assess_data_quality');
		const window = data(trace[1]);
		const quality = data(trace[2]);
		return {
			kind: 'final',
			findings: [
				{
					statement: `The selected parsed-time window contains ${window.sampleCount} samples; valid and unavailable counts are recorded for RPM, MAP, AFR, and CLT.`,
					evidenceIds: [trace[1].evidenceId]
				},
				{
					statement: `The log has ${quality.invalidTimeCount} invalid parsed timestamps, ${quality.timeInversionCount} adjacent time inversions, and ${(quality.channelIssues as JsonValue[]).length} unresolved or unavailable channel mappings.`,
					evidenceIds: [trace[2].evidenceId]
				}
			],
			limitations: [
				'No transient/steady-state eligibility or fueling causation has been established.',
				'This is a scripted-model harness, not an autonomous model evaluation.'
			]
		};
	}
};

it('runs a scripted investigation on a real log and associated calibration fixtures', async () => {
	const context = await loadInvestigationFiles({
		id: 'block1-demo',
		calibrationId: 'block1-calibration',
		logPath: fileURLToPath(new URL('../fixtures/msl/2025-04-12_16.16.28.msl', import.meta.url)),
		vePath: fileURLToPath(new URL('../fixtures/xml/ve.table', import.meta.url)),
		afrPath: fileURLToPath(new URL('../fixtures/xml/afr.table', import.meta.url))
	});
	const result = await runInvestigation(context, model, {
		goal: 'Inspect the first minute of available parsed telemetry and report data-quality limitations.'
	});
	expect(context.logEncoding).toBe('windows-1252');
	for (const slot of ['clt', 'mat', 'egt1'] as const) {
		expect(context.session.channelMapping.resolve(slot, context.session)).toMatchObject({
			status: 'resolved',
			sourceUnit: '°F',
			unit: '°C'
		});
	}
	expect(data(result.trace[0]).logEncoding).toBe('windows-1252');
	expect(result.status, result.reason ?? '').toBe('completed');
	expect(result.trace.map((entry) => entry.tool)).toEqual([
		'describe_log',
		'summarize_window',
		'assess_data_quality'
	]);
	expect(result.trace.every((entry) => entry.result.ok)).toBe(true);
	const window = data(result.trace[1]);
	const times = context.session.timeSec()!;
	const rows = times
		.map((time, row) => ({ time, row }))
		.filter(
			({ time }) =>
				Number.isFinite(time) && time >= Number(window.startSec) && time <= Number(window.endSec)
		);
	expect(window.sampleCount).toBe(rows.length);
	const rpm = rows
		.map(({ row }) => context.session.findChannel('RPM')!.values[row])
		.filter(Number.isFinite);
	const statistics = window.statistics as Record<string, JsonValue>[];
	const coolant = statistics[3];
	expect(coolant.validCount).toBe(rows.length);
	expect(coolant.unavailableCount).toBe(0);
	const fahrenheit = rows.map(({ row }) => context.session.findChannel('CLT')!.values[row]);
	const celsiusMean =
		fahrenheit.reduce((sum, value) => sum + ((value - 32) * 5) / 9, 0) / fahrenheit.length;
	expect(coolant.mean).toBeCloseTo(celsiusMean, 6);
	expect(statistics[0].validCount).toBe(rpm.length);
	expect(statistics[0].mean).toBeCloseTo(
		rpm.reduce((sum, value) => sum + value, 0) / rpm.length,
		6
	);
	expect(result.report!.findings).toHaveLength(2);
	expect(() => JSON.stringify(result)).not.toThrow();
	console.info(
		'Scripted investigation result:',
		JSON.stringify(
			{
				status: result.status,
				tools: result.trace.map((entry) => ({ evidenceId: entry.evidenceId, tool: entry.tool })),
				report: result.report
			},
			null,
			2
		)
	);
}, 15000);
