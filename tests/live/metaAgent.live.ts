import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadInvestigationFiles } from '../../src/lib/server/investigation/context';
import {
	MetaResponsesModel,
	META_MODEL
} from '../../src/lib/server/investigation/metaResponsesModel';
import { runInvestigation } from '../../src/lib/server/investigation/runner';

it('investigates a real log with Muse Spark native tool calls', async () => {
	// Fail clearly when explicitly invoked without credentials; never silently skip.
	const model = new MetaResponsesModel();
	const context = await loadInvestigationFiles({
		id: 'block1-live',
		calibrationId: 'block1-calibration',
		logPath: fileURLToPath(new URL('../fixtures/msl/2025-04-12_16.16.28.msl', import.meta.url)),
		vePath: fileURLToPath(new URL('../fixtures/xml/ve.table', import.meta.url)),
		afrPath: fileURLToPath(new URL('../fixtures/xml/afr.table', import.meta.url))
	});
	const result = await runInvestigation(context, model, {
		goal: 'Inspect data quality in the first 60 seconds of available parsed telemetry. Use describe_log to discover time bounds and units, summarize_window for RPM, MAP (load), AFR and coolant (clt), and assess_data_quality for log-wide issues. Explain missing or unresolved evidence and whether further investigation needs better data. Do not recommend tuning changes.',
		maxIterations: 9,
		maxToolCalls: 6,
		timeoutMs: 300000
	});
	console.info(
		'Live Meta investigation:',
		JSON.stringify({ model: META_MODEL, ...result, adapterError: model.lastError }, null, 2)
	);
	expect(result.status, model.lastError ?? result.reason ?? '').toBe('completed');
	const used = result.trace.filter((entry) => entry.result.ok).map((entry) => entry.tool);
	for (const name of ['describe_log', 'summarize_window', 'assess_data_quality'])
		expect(used).toContain(name);
	expect(result.report).not.toBeNull();
});
