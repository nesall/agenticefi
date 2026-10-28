import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

try {
	const { values, tokens } = parseArgs({
		options: {
			dataset: { type: 'string', default: 'april' },
			profile: { type: 'string', default: 'v1' },
			resilient: { type: 'boolean', default: false },
			'worker-heap-mb': { type: 'string', default: 'auto' },
			help: { type: 'boolean', default: false }
		},
		tokens: true
	});
	const seen = new Set();
	for (const token of tokens) {
		if (token.kind !== 'option') continue;
		if (seen.has(token.name)) throw new Error(`Duplicate --${token.name}.`);
		seen.add(token.name);
	}
	if (values.help) {
		console.info(
			'Usage: npm run test:agent:analytical:live -- --dataset april|july|august|august1 --profile v1|v2 [--resilient] [--worker-heap-mb auto|512|1024]\nDefault: april v1, no retries. Auto heap: August 8 = 1024 MiB; others = 512 MiB. --resilient allows two retries per model turn for HTTP 429/500/502/503/504 within the original deadline. august/aug/august8 = August 8 (block2); august1 = August 1 (missing AFR).'
		);
	} else {
		const dataset = ['aug', 'august8'].includes(values.dataset) ? 'august' : values.dataset;
		if (
			!['april', 'july', 'august', 'august1'].includes(dataset) ||
			!['v1', 'v2'].includes(values.profile) ||
			!['auto', '512', '1024'].includes(values['worker-heap-mb'])
		)
			throw new Error('Invalid dataset, profile, or worker heap selection. Use --help.');
		const reportId = randomUUID();
		const startedAt = new Date().toISOString();
		const started = performance.now();
		const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
		const result = spawnSync(
			process.execPath,
			[cli, 'run', '--config', 'vitest.analytical-live.config.ts', '--reporter=verbose'],
			{
				stdio: 'inherit',
				env: {
					...process.env,
					AGENTICEFI_SMOKE_DATASET: values.dataset,
					AGENTICEFI_SMOKE_PROFILE: values.profile,
					AGENTICEFI_SMOKE_RESILIENT: String(values.resilient),
					AGENTICEFI_SMOKE_REPORT_ID: reportId,
					AGENTICEFI_SMOKE_WORKER_HEAP_MB: values['worker-heap-mb']
				}
			}
		);
		if (result.error) console.error('Unable to start analytical smoke test.');
		const latestPath = `reports/analytical-tools/${dataset}-${values.profile}-live-smoke.json`;
		let reported = false;
		try {
			reported = JSON.parse(readFileSync(latestPath, 'utf8')).reportId === reportId;
		} catch {
			/* No report for this execution. */
		}
		if (!reported) {
			const archivePath = latestPath.replace(
				/\.json$/,
				`-${startedAt.replace(/[:.]/g, '-')}-${reportId}.json`
			);
			const payload =
				JSON.stringify(
					{
						reportId,
						startedAt,
						source:
							'Smoke launcher process-exit diagnostics; no model response or numerical result invented',
						outcome: 'harness-process-failure',
						elapsedMs: performance.now() - started,
						selection: { dataset, profile: values.profile, workerHeap: values['worker-heap-mb'] },
						subprocess: {
							exitCode: result.status,
							signal: result.signal,
							spawnFailed: !!result.error
						},
						requests: null,
						modelTurns: null,
						usage: {
							status: 'unavailable',
							inputTokens: null,
							outputTokens: null,
							totalTokens: null,
							estimatedCost: null
						},
						limitation:
							'The subprocess exited before writing its report. API execution and cause are unknown; resource exhaustion is possible but not proven by this fallback. No whole-run retry was performed.'
					},
					null,
					2
				) + '\n';
			mkdirSync('reports/analytical-tools', { recursive: true });
			writeFileSync(archivePath, payload, { flag: 'wx' });
			writeFileSync(latestPath, payload);
			console.error(`Smoke subprocess did not write a report. Saved ${archivePath}`);
		}
		process.exitCode = reported ? (result.status ?? 1) : result.status || 1;
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : 'Invalid smoke test arguments.');
	process.exitCode = 1;
}
