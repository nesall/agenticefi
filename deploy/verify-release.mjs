import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const augustFiles = [
	'2026-08-08_11.19.56.msl',
	'veTable1_2026-08-08_23.57.53.table',
	'AFR_2026-07-30_19.40.54.table'
];
export const mandatory = [
	'build/index.js',
	'build/handler.js',
	'.analytical-worker/entry.cjs',
	...augustFiles.map((n) => `.demo-assets/august8/${n}`),
	'.demo-assets/recordings/august-v1-live-smoke.json',
	'package.json',
	'package-lock.json',
	'deploy/verify-release.mjs',
	'deploy/smoke-release.mjs'
];
/** @param {Uint8Array | string} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const deploymentFiles = [
	'verify-release.mjs',
	'smoke-release.mjs',
	'agenticefi.service',
	'agenticefi.env.example',
	'nginx-http.conf',
	'nginx-https.conf',
	'nginx-limits.conf',
	'drain.sh'
];
/** @param {string} path */
export function dependencyOwner(path) {
	const parts = path.split('/'),
		index = parts.lastIndexOf('node_modules');
	if (index < 0) return null;
	return parts.slice(0, index + (parts[index + 1]?.startsWith('@') ? 3 : 2)).join('/');
}
/** @param {string} root */
export function filesUnder(root) {
	/** @type {string[]} */
	const files = [];
	/** @param {string} dir */
	function visit(dir) {
		for (const name of readdirSync(dir).sort()) {
			const path = resolve(dir, name),
				rel = relative(root, path).split(sep).join('/');
			if (rel === '.investigation-diagnostics') continue; // Runtime state is deliberately outside the release manifest.
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new Error('Release contains an unexpected symbolic link.');
			if (stat.isDirectory()) visit(path);
			else if (stat.isFile()) files.push(rel);
			else throw new Error('Release contains an unsupported file type.');
		}
	}
	visit(resolve(root));
	return files.sort();
}
/** @param {string} root */
export function verifyRelease(root) {
	const [major, minor] = process.versions.node.split('.').map(Number);
	if (major < 22 || (major === 22 && minor < 17))
		throw new Error('Node 22.17 or newer is required.');
	root = resolve(root);
	const manifest = JSON.parse(readFileSync(resolve(root, 'release-manifest.json'), 'utf8'));
	if (manifest.version !== 1) throw new Error('Unsupported release manifest.');
	const paths = Object.keys(manifest.files).sort();
	/** @type {{packages: Record<string, {dev?: boolean, version?: string}>}} */
	const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	const packages = new Set(
		Object.entries(lock.packages)
			.filter(([p, v]) => p && !v.dev)
			.map(([p]) => p)
	);
	if (
		JSON.stringify(paths) !==
		JSON.stringify(filesUnder(root).filter((p) => p !== 'release-manifest.json'))
	)
		throw new Error('Release file inventory mismatch.');
	for (const path of paths) {
		if (
			path.includes('\\') ||
			path.startsWith('/') ||
			path.split('/').some((p) => p === '..' || !p)
		)
			throw new Error('Unsafe release path.');
		const allowed =
			path.startsWith('build/') ||
			path === '.analytical-worker/entry.cjs' ||
			augustFiles.some((n) => path === `.demo-assets/august8/${n}`) ||
			/^\.demo-assets\/recordings\/(april|august)-v[12]-live-smoke\.json$/.test(path) ||
			['package.json', 'package-lock.json'].includes(path) ||
			deploymentFiles.some((n) => path === `deploy/${n}`) ||
			(path.startsWith('node_modules/') && packages.has(dependencyOwner(path) ?? ''));
		if (!allowed || /(^|\/)(\.env(?:\..*)?|\.npmrc|\.git)(\/|$)/.test(path))
			throw new Error('Unapproved release content.');
		const bytes = readFileSync(resolve(root, path)),
			expected = manifest.files[path];
		if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)
			throw new Error(`Release integrity mismatch: ${path}`);
	}
	for (const path of mandatory)
		if (!manifest.files[path]) throw new Error(`Missing required release file: ${path}`);
	if (!paths.some((p) => p.startsWith('build/client/_app/immutable/')))
		throw new Error('Generated client assets missing.');
	for (const [path, pkg] of Object.entries(lock.packages).filter(([p, v]) => p && !v.dev)) {
		const installed = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
		if (installed.version !== pkg.version)
			throw new Error('Production dependency version mismatch.');
	}
	return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const manifest = verifyRelease(
			process.argv[2] ?? resolve(fileURLToPath(new URL('..', import.meta.url)))
		);
		console.log(`Release ${manifest.releaseId}: integrity verified.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'Release verification failed.');
		process.exitCode = 1;
	}
}
