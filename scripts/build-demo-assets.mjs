import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { gunzipSync } from 'node:zlib';
const files = [
	'2026-08-08_11.19.56.msl',
	'veTable1_2026-08-08_23.57.53.table',
	'AFR_2026-07-30_19.40.54.table'
];
mkdirSync('.demo-assets/august8', { recursive: true });
for (const file of files) {
	const compressed = file.endsWith('.msl');
	const bytes = readFileSync(`src/lib/server/demo/august8/${file}${compressed ? '.gz' : ''}`);
	writeFileSync(`.demo-assets/august8/${file}`, compressed ? gunzipSync(bytes) : bytes);
}
for (const dataset of ['april', 'august'])
	for (const profile of ['v1', 'v2']) {
		const file = `${dataset}-${profile}-live-smoke.json`,
			source = `reports/analytical-tools/${file}`;
		if (!existsSync(source) || statSync(source).size > 1024 * 1024) continue;
		try {
			const recording = JSON.parse(readFileSync(source, 'utf8'));
			if (recording.outcome !== 'passed' || recording.model !== 'muse-spark-1.3-contributor')
				continue;
			mkdirSync('.demo-assets/recordings', { recursive: true });
			copyFileSync(source, `.demo-assets/recordings/${file}`);
		} catch {
			console.info(`Skipping invalid recording ${file}.`);
		}
	}
