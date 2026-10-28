import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { decodeMsl } from '../../src/lib/server/msl/decodeMsl';
import type { AnalyticalInput } from '../../src/lib/server/investigation/analyticalSettings';

const datasets = {
	april: {
		log: 'src/lib/server/demo/rx7.msl',
		logName: '2025-04-12_16.16.28.msl',
		ve: 'src/lib/server/demo/ve.table',
		afr: 'src/lib/server/demo/afr.table',
		calibrationId: 'block1-calibration'
	},
	july: {
		log: 'data/logs/block1/2026-07-25_17.56.47.msl',
		ve: 'src/lib/server/demo/ve.table',
		afr: 'src/lib/server/demo/afr.table',
		calibrationId: 'block1-calibration'
	},
	august: {
		log: 'data/logs/block2/2026-08-08_11.19.56.msl',
		ve: 'data/logs/block2/veTable1_2026-08-08_23.57.53.table',
		afr: 'data/logs/block2/AFR_2026-07-30_19.40.54.table',
		calibrationId: 'block2-calibration'
	},
	august1: {
		log: 'data/logs/block3/2026-08-01_09.45.13.msl',
		ve: 'data/logs/block3/veTable1Tbl_2026-08-02_00.24.28.table',
		afr: null,
		calibrationId: 'block3-calibration'
	}
} as const;

export function smokeSelection(dataset = 'april', profile = 'v1', heap = 'auto') {
	const canonical = dataset === 'aug' || dataset === 'august8' ? 'august' : dataset;
	if (!Object.hasOwn(datasets, canonical))
		throw new Error('Unknown dataset; use april, july, august (August 8), or august1 (August 1).');
	if (profile !== 'v1' && profile !== 'v2') throw new Error('Unknown profile; use v1 or v2.');
	const id = canonical as keyof typeof datasets;
	if (!['auto', '512', '1024'].includes(heap))
		throw new Error('Worker heap must be auto, 512, or 1024 MiB.');
	const workerHeapMb: 512 | 1024 =
		heap === '1024' || (heap === 'auto' && id === 'august') ? 1024 : 512;
	return {
		dataset: id,
		profile,
		workerHeapMb,
		sources: datasets[id],
		version:
			profile === 'v1' ? ('steady-afr-ve-v1' as const) : ('steady-afr-ve-v2-experimental' as const),
		reportPath: `reports/analytical-tools/${id}-${profile}-live-smoke.json`
	};
}
export type SmokeSelection = ReturnType<typeof smokeSelection>;

export class SmokeDatasetUnavailable extends Error {}
export class SmokeResourceUnavailable extends Error {}

export function loadSmokeDataset(selection: SmokeSelection): AnalyticalInput {
	if (selection.dataset === 'august' && selection.workerHeapMb < 1024)
		throw new SmokeResourceUnavailable(
			'August 8 exhausts the 512 MiB worker tier; use --worker-heap-mb 1024 (the automatic August setting). No API request was made.'
		);
	const { sources } = selection;
	if (!sources.afr)
		throw new SmokeDatasetUnavailable(
			'August 1 block3 has no associated AFR table; analysis unavailable. No calibration substituted.'
		);
	for (const [kind, path] of Object.entries(sources)) {
		if (!['log', 've', 'afr'].includes(kind)) continue;
		if (!existsSync(path))
			throw new SmokeDatasetUnavailable(`Selected ${kind} source is unavailable: ${path}`);
	}
	return {
		contextId: `${selection.dataset}-${selection.profile}-single-live-smoke`,
		logName: 'logName' in sources ? sources.logName : basename(sources.log),
		logContent: decodeMsl(readFileSync(sources.log)).content,
		calibrationId: sources.calibrationId,
		calibrationSemantics: 'rpm-map-kpa-afr',
		veXml: readFileSync(sources.ve, 'utf8'),
		afrXml: readFileSync(sources.afr, 'utf8'),
		profile: { version: selection.version },
		workerHeapMb: selection.workerHeapMb
	};
}
