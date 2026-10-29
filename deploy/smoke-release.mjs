import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyRelease, augustFiles } from './verify-release.mjs';

const source = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = realpathSync(tmpdir());
const scratch = mkdtempSync(resolve(temporaryRoot, 'agenticefi-release-'));
const isolated = resolve(scratch, 'application'),
	previous = process.cwd();
let server;
const previousDiagnosticsDirectory = process.env.AGENTICEFI_DIAGNOSTICS_DIR;
try {
	verifyRelease(source);
	cpSync(source, isolated, {
		recursive: true,
		filter: (path) => path !== resolve(source, '.investigation-diagnostics')
	});
	verifyRelease(isolated);
	for (const path of ['src', 'data', 'reports', '.env', '.git', 'scripts'])
		assert.equal(existsSync(resolve(isolated, path)), false);
	process.chdir(isolated);
	// Exercise the very recorder imported by the compiled endpoint, without a model request.
	// Store outside the release, as ProtectSystem=strict requires on production Linux.
	const diagnosticsDirectory = resolve(scratch, 'state', 'investigation-diagnostics');
	process.env.AGENTICEFI_DIAGNOSTICS_DIR = diagnosticsDirectory;
	const endpoint = resolve('build/server/entries/endpoints/api/investigations/_server.ts.js');
	const recorderImport = [
		...readFileSync(endpoint, 'utf8').matchAll(/import \{([^}]+)\} from "([^"]+)";/g)
	].find((match) => /\bas InvestigationDiagnostics\b/.test(match[1]));
	assert.ok(recorderImport, 'Compiled endpoint diagnostics import missing.');
	const recorderExport = /(\w+)\s+as InvestigationDiagnostics\b/.exec(recorderImport[1]);
	assert.ok(recorderExport);
	const compiled = await import(pathToFileURL(resolve(dirname(endpoint), recorderImport[2])).href);
	const diagnostics = new compiled[recorderExport[1]]();
	const diagnosticJob = '11111111-1111-4111-8111-111111111111';
	diagnostics.bind(diagnosticJob);
	await diagnostics.flush();
	assert.equal(
		JSON.parse(readFileSync(resolve(diagnosticsDirectory, diagnosticJob + '.json'), 'utf8')).jobId,
		diagnosticJob
	);
	assert.equal(existsSync(resolve(isolated, '.investigation-diagnostics')), false);
	// Exercise the shipped worker with two synthetic rows and packaged calibration assets.
	// No fitting is requested and no preparation/fitting defaults are recreated here.
	const worker = new Worker(resolve('.analytical-worker/entry.cjs'), {
		resourceLimits: { maxOldGenerationSizeMb: 128 },
		workerData: {
			runId: 'release-smoke',
			settingsId: 'synthetic-inspection',
			snapshot: {
				contextId: 'synthetic',
				calibrationId: 'block2-calibration',
				calibrationSemantics: 'rpm-map-kpa-afr',
				logName: 'synthetic.msl',
				logContent: 'Time\tRPM\tMAP\tAFR\ns\trpm\tkPa\tAFR\n0\t1000\t50\t14\n1\t1000\t50\t14',
				veXml: readFileSync(resolve('.demo-assets/august8', augustFiles[1]), 'utf8'),
				afrXml: readFileSync(resolve('.demo-assets/august8', augustFiles[2]), 'utf8'),
				settings: {
					profile: { version: 'steady-afr-ve-v1' },
					limits: { maxRows: 2, maxChannels: 4, maxCells: 256, maxArtifactBytes: 65536 }
				}
			}
		}
	});
	try {
		const result = await new Promise((resolveResult, reject) => {
			const timer = setTimeout(() => reject(new Error('Packaged worker timed out.')), 10000);
			worker.once('message', (message) => {
				clearTimeout(timer);
				resolveResult(message);
			});
			worker.once('error', () => {
				clearTimeout(timer);
				reject(new Error('Packaged worker failed.'));
			});
			worker.postMessage({ id: 1, action: 'tool', name: 'describe_log', args: {} });
		});
		assert.equal(result.ok, true);
		assert.equal(result.value.data.rowCount, 2);
	} finally {
		await worker.terminate();
	}
	server = spawn(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`const app=await import('./build/index.js'); const ready=()=>process.send({port:app.server.address().port}); if(app.server.listening)ready();else app.server.once('listening',ready); process.once('message',()=>{app.server.closeIdleConnections();app.server.close(()=>process.disconnect());});`
		],
		{
			cwd: isolated,
			windowsHide: true,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			env: {
				...process.env,
				NODE_ENV: 'production',
				NODE_PATH: '',
				NODE_OPTIONS: '',
				META_HACKATHON_API_KEY: '',
				META_API_KEY: '',
				AGENTICEFI_DIAGNOSTICS_DIR: diagnosticsDirectory,
				HOST: '127.0.0.1',
				PORT: '0',
				SOCKET_PATH: '',
				LISTEN_PID: '0',
				LISTEN_FDS: '0',
				IDLE_TIMEOUT: '0',
				PROTOCOL_HEADER: 'x-forwarded-proto',
				HOST_HEADER: 'x-forwarded-host',
				BODY_SIZE_LIMIT: '16K'
			}
		}
	);
	const port = await new Promise((resolvePort, reject) => {
		const timer = setTimeout(() => reject(new Error('Isolated server startup timed out.')), 10000);
		server.once('message', (message) => {
			clearTimeout(timer);
			resolvePort(message.port);
		});
		server.once('error', () => {
			clearTimeout(timer);
			reject(new Error('Isolated server startup failed.'));
		});
		server.once('exit', () => {
			clearTimeout(timer);
			reject(new Error('Isolated server exited before startup.'));
		});
	});
	const base = `http://127.0.0.1:${port}`,
		origin = 'https://demo.example.invalid';
	const forwarded = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'demo.example.invalid' };
	let cookie = '';
	const request = (path, body, customOrigin = origin) =>
		fetch(base + path, {
			method: body === undefined ? 'GET' : 'POST',
			signal: AbortSignal.timeout(30000),
			redirect: 'manual',
			headers: {
				...forwarded,
				...(cookie ? { cookie } : {}),
				...(body === undefined ? {} : { Origin: customOrigin, 'Content-Type': 'application/json' })
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
	assert.equal((await request('/')).status, 200);
	const catalogue = await (await request('/api/demo')).json();
	assert.ok(catalogue.datasets.every((d) => d.available));
	for (const path of [
		'/.env',
		'/.analytical-worker/entry.cjs',
		'/.demo-assets/august8/' + augustFiles[0],
		'/.investigation-diagnostics/private.json',
		'/server/chunks/dashboardHttp.js',
		'/deploy/agenticefi.env.example',
		'/node_modules/svelte/package.json'
	])
		assert.equal((await request(path)).status, 404);
	const april = await request('/api/demo', { datasetId: 'april' });
	assert.equal(april.status, 200);
	assert.match(april.headers.get('set-cookie'), /Secure/);
	cookie = april.headers.get('set-cookie').split(';')[0];
	assert.equal((await april.json()).rowCount, 2859);
	assert.equal(
		(await request('/api/demo', { datasetId: 'april' }, 'https://wrong.example.invalid')).status,
		403
	);
	assert.equal((await request('/api/demo', { padding: 'x'.repeat(20000) })).status, 413);
	for (const path of ['/api/demo/', '/api/investigations/'])
		assert.equal((await request(path, {})).status, 308);
	const augustResponse = await request('/api/demo', { datasetId: 'august8' });
	assert.equal(augustResponse.status, 200);
	const august = await augustResponse.json();
	assert.equal(august.rowCount, 56284);
	assert.equal(august.museAvailable, false);
	const window = `startSec=${august.startSec}&endSec=${Math.min(august.endSec, august.startSec + 60)}`;
	const chart = await (await request(`/api/sessions/${august.id}/telemetry?${window}`)).json();
	const screening = await (
		await request(`/api/sessions/${august.id}/eligibility?${window}&limit=12`)
	).json();
	assert.ok(chart.pointCount > 0 && chart.pointCount <= 8000);
	assert.equal(screening.total, chart.pointCount);
	const started = await request('/api/investigations', {
		sessionId: august.id,
		goal: 'Inspect recorded advisory result.',
		mode: 'analytical',
		profile: 'v1',
		source: 'recorded',
		startSec: august.startSec,
		endSec: august.startSec + 60
	});
	assert.equal(started.status, 200);
	const job = await started.json();
	let result;
	for (let i = 0; i < 40; i++) {
		result = await (await request(`/api/investigations/${job.id}`)).json();
		if (result.state === 'finished') break;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(result.outcome, 'completed');
	assert.equal(result.source, 'recorded');
	assert.equal((await request(`/api/investigations/${job.id}/ve-export`)).status, 409);
	cookie = 'agenticefi_owner=other-owner';
	assert.equal((await request(`/api/investigations/${job.id}`)).status, 404);
	assert.equal((await request(`/api/investigations/${job.id}/ve-export`)).status, 404);
	console.log(
		'Isolated release passed: integrity, configured compiled diagnostics outside release, shipped worker, April/August, synchronized initial window, HTTPS ownership, 413, private paths, route variants, polling and recorded investigation. No Meta calls.'
	);
} catch (error) {
	console.error(`Release smoke failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	if (server?.pid && server.exitCode === null) {
		const exited = once(server, 'exit');
		const timer = setTimeout(() => server.kill(), 5000);
		if (server.connected) server.send('stop');
		else server.kill();
		await exited;
		clearTimeout(timer);
	}
	process.chdir(previous);
	if (previousDiagnosticsDirectory === undefined) delete process.env.AGENTICEFI_DIAGNOSTICS_DIR;
	else process.env.AGENTICEFI_DIAGNOSTICS_DIR = previousDiagnosticsDirectory;
	// Only remove the exact directory created by mkdtemp, never an arbitrary CLI path.
	if (
		dirname(scratch) === temporaryRoot &&
		scratch.startsWith(resolve(temporaryRoot, 'agenticefi-release-'))
	)
		rmSync(scratch, { recursive: true, force: true });
	else {
		console.error('Unsafe temporary cleanup path; directory retained.');
		process.exitCode = 1;
	}
}
