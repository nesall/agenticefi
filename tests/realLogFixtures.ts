import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Original log bytes from public, versioned fixtures; no private data/logs dependency. */
export function realLogBytes(name: string): Buffer {
	if (name === '2026-08-08_11.19.56.msl')
		return gunzipSync(
			readFileSync(new URL('../src/lib/server/demo/august8/' + name + '.gz', import.meta.url))
		);
	if (
		!['2025-04-12_16.16.28.msl', '2026-07-25_17.56.47.msl', '2026-08-01_09.45.13.msl'].includes(
			name
		)
	)
		throw new Error('Unknown real-log fixture.');
	return readFileSync(new URL('./fixtures/msl/' + name, import.meta.url));
}
