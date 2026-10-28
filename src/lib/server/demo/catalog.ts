import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDemo } from './index';
import { createInvestigationContext } from '../investigation/context';
import { decodeMsl } from '../msl/decodeMsl';
import type { AnalyticalInput } from '../investigation/analyticalSettings';
import type { DemoId } from '../../shared/types/analyticalDashboard';
import logContent from './rx7.msl?raw';
import aprilVeXml from './ve.table?raw';
import aprilAfrXml from './afr.table?raw';

const files = {
	log: '2026-08-08_11.19.56.msl',
	ve: 'veTable1_2026-08-08_23.57.53.table',
	afr: 'AFR_2026-07-30_19.40.54.table'
};
const cache = new Map<
	DemoId,
	Promise<{ context: ReturnType<typeof loadDemo>; input: AnalyticalInput }>
>();
export function demoId(value: unknown): DemoId {
	if (value === undefined || value === 'april') return 'april';
	if (value === 'august8') return 'august8';
	throw new Error('Choose April or August 8.');
}
function augustDirectory() {
	return ['.demo-assets/august8', 'data/logs/block2']
		.map((dir) => resolve(dir))
		.find((dir) => Object.values(files).every((file) => existsSync(resolve(dir, file))));
}
export function demoCatalog() {
	return [
		{ id: 'april' as const, label: 'April 12 · 3-minute drive', available: true },
		{
			id: 'august8' as const,
			label: 'August 8 · extended RX-7 drive',
			available: !!augustDirectory()
		}
	];
}
/** Two curated, shared read-only source snapshots; owner sessions retain independent identities. */
export async function curatedDemo(id: DemoId) {
	let pending = cache.get(id);
	if (!pending) {
		pending = (async () => {
			if (id === 'april')
				return {
					context: loadDemo('curated-april'),
					input: {
						contextId: 'curated-april',
						logName: '2025-04-12_16.16.28.msl',
						logContent,
						veXml: aprilVeXml,
						afrXml: aprilAfrXml,
						calibrationId: 'block1-calibration',
						calibrationSemantics: 'rpm-map-kpa-afr' as const,
						workerHeapMb: 512 as const
					}
				};
			const dir = augustDirectory();
			if (!dir) throw new Error('August demo assets are unavailable on this server.');
			const [bytes, veXml, afrXml] = await Promise.all([
				readFile(resolve(dir, files.log)),
				readFile(resolve(dir, files.ve), 'utf8'),
				readFile(resolve(dir, files.afr), 'utf8')
			]);
			const decoded = decodeMsl(bytes);
			const input: AnalyticalInput = {
				contextId: 'curated-august8',
				logName: files.log,
				logContent: decoded.content,
				veXml,
				afrXml,
				calibrationId: 'block2-calibration',
				calibrationSemantics: 'rpm-map-kpa-afr',
				workerHeapMb: 1024
			};
			return {
				input,
				context: createInvestigationContext({
					...input,
					veXml,
					afrXml,
					id: input.contextId,
					logEncoding: decoded.encoding
				})
			};
		})();
		cache.set(id, pending);
		pending.catch(() => cache.delete(id));
	}
	return pending;
}
