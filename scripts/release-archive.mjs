import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';

/** Minimal deterministic USTAR archive: regular allowlisted files only, uid/gid/mtime fixed.
 * @param {string} root
 * @param {string[]} paths
 * @param {string} destination
 */
export async function releaseArchive(root, paths, destination) {
	const gzip = createGzip({ level: 9 }),
		completed = pipeline(gzip, createWriteStream(destination, { flags: 'wx' }));
	// Attach rejection immediately, including failures while feeding the compressor.
	void completed.catch(() => {});
	/** @param {Uint8Array} bytes */
	const write = async (bytes) => {
		if (!gzip.write(bytes)) await once(gzip, 'drain');
	};
	/** @param {Buffer} header @param {string} value @param {number} start @param {number} length */
	const field = (header, value, start, length) => header.write(value, start, length, 'utf8');
	/** @param {number} value @param {number} length */
	const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
	try {
		for (const path of [...paths].sort()) {
			if (
				!/^[a-zA-Z0-9_@./+-]+$/.test(path) ||
				path.startsWith('/') ||
				path.split('/').includes('..')
			)
				throw new Error('Unsafe archive path.');
			let name = path,
				prefix = '';
			if (Buffer.byteLength(name) > 100) {
				const split = path.lastIndexOf('/');
				prefix = path.slice(0, split);
				name = path.slice(split + 1);
			}
			if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155)
				throw new Error('Archive path exceeds USTAR limits.');
			const size = (await stat(resolve(root, path))).size;
			if (size > 0o77777777777) throw new Error('Archive file exceeds USTAR limits.');
			const header = Buffer.alloc(512);
			field(header, name, 0, 100);
			field(header, octal(0o644, 8), 100, 8);
			field(header, octal(0, 8), 108, 8);
			field(header, octal(0, 8), 116, 8);
			field(header, octal(size, 12), 124, 12);
			field(header, octal(0, 12), 136, 12);
			header.fill(32, 148, 156);
			header[156] = 48;
			field(header, 'ustar\0', 257, 6);
			field(header, '00', 263, 2);
			field(header, prefix, 345, 155);
			const checksum = header.reduce((sum, byte) => sum + byte, 0);
			field(header, checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
			await write(header);
			for await (const chunk of createReadStream(resolve(root, path))) await write(chunk);
			if (size % 512) await write(Buffer.alloc(512 - (size % 512)));
		}
		await write(Buffer.alloc(1024));
		gzip.end();
		await completed;
	} catch (error) {
		gzip.destroy(error instanceof Error ? error : new Error('Archive failed.'));
		await completed.catch(() => {});
		throw error;
	}
}
