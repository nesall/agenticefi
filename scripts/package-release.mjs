import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import {
	augustFiles,
	deploymentFiles,
	mandatory,
	filesUnder,
	sha256,
	verifyRelease
} from '../deploy/verify-release.mjs';
import { releaseArchive } from './release-archive.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const id = process.argv[2];
try {
	if (!id || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id))
		throw new Error('Supply a release ID: npm run release:package -- demo-YYYYMMDD-N');
	const output = resolve(project, '.releases', id),
		archive = output + '.tar.gz';
	if (existsSync(output) || existsSync(archive))
		throw new Error('Release ID already exists; use a new ID.');
	const lock = JSON.parse(readFileSync(resolve(project, 'package-lock.json'), 'utf8'));
	const packages = Object.entries(lock.packages).filter(([path, pkg]) => path && !pkg.dev);
	const copy = (path, packageCopy = false) => {
		const from = resolve(project, path),
			to = resolve(output, path);
		cpSync(from, to, {
			recursive: true,
			filter: (src) => {
				const name = basename(src),
					info = lstatSync(src);
				if (info.isSymbolicLink()) throw new Error('Symlink in release input; packaging stopped.');
				if (packageCopy && src !== from && info.isDirectory() && name === 'node_modules')
					return false;
				if (/^\.env(?:\.|$)|^\.npmrc$|^\.git$/.test(name) || name.endsWith('.node'))
					throw new Error('Private or platform-specific release input; packaging stopped.');
				return true;
			}
		});
	};
	for (const name of augustFiles) {
		const source = readFileSync(
			resolve(project, 'src/lib/server/demo/august8', name + (name.endsWith('.msl') ? '.gz' : ''))
		);
		const original = name.endsWith('.msl') ? gunzipSync(source) : source;
		const staged = readFileSync(resolve(project, '.demo-assets/august8', name));
		if (sha256(original) !== sha256(staged))
			throw new Error('August assets differ from their confirmed source; rebuild first.');
	}
	const recordings = [];
	for (const dataset of ['april', 'august'])
		for (const profile of ['v1', 'v2']) {
			const name = `${dataset}-${profile}-live-smoke.json`,
				source = resolve(project, 'reports/analytical-tools', name);
			if (!existsSync(source)) {
				if (dataset === 'august' && profile === 'v1')
					throw new Error('Mandatory August V1 recording missing.');
				continue;
			}
			const recording = JSON.parse(readFileSync(source, 'utf8'));
			if (
				recording.outcome !== 'passed' ||
				recording.model !== 'muse-spark-1.3-contributor' ||
				recording.selection?.dataset !== dataset ||
				recording.selection?.profile !== profile ||
				recording.validatedInvestigation?.status !== 'completed' ||
				recording.selection?.sources?.calibrationId !==
					(dataset === 'august' ? 'block2-calibration' : 'block1-calibration')
			)
				throw new Error('Recording identity/validation mismatch.');
			const staged = `.demo-assets/recordings/${name}`;
			if (sha256(readFileSync(source)) !== sha256(readFileSync(resolve(project, staged))))
				throw new Error('Stale staged recording; rebuild first.');
			recordings.push(staged);
		}
	for (const [path, pkg] of packages) {
		if (pkg.link || pkg.os || pkg.cpu || pkg.hasInstallScript)
			throw new Error(
				'Platform-specific production dependency needs a target-platform release procedure.'
			);
		const installed = JSON.parse(readFileSync(resolve(project, path, 'package.json'), 'utf8'));
		if (installed.version !== pkg.version)
			throw new Error('Installed production dependency differs from lockfile; run npm ci.');
	}
	mkdirSync(output, { recursive: true });
	for (const path of [
		'build',
		'.analytical-worker/entry.cjs',
		...augustFiles.map((n) => `.demo-assets/august8/${n}`),
		...recordings,
		'package.json',
		'package-lock.json',
		...deploymentFiles.map((n) => `deploy/${n}`)
	])
		copy(path);
	for (const [path] of packages) copy(path, true);
	const envFile = resolve(project, '.env');
	const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
	const secrets = [
		process.env.META_HACKATHON_API_KEY,
		process.env.META_API_KEY,
		local.META_HACKATHON_API_KEY,
		local.META_API_KEY
	].filter((k) => k && k.length >= 8);
	const files = {};
	for (const path of filesUnder(output)) {
		const bytes = readFileSync(resolve(output, path));
		if (secrets.some((key) => bytes.includes(Buffer.from(key))))
			throw new Error('Potential credential material detected; packaging stopped.');
		files[path] = { bytes: bytes.length, sha256: sha256(bytes) };
	}
	for (const path of mandatory)
		if (!files[path]) throw new Error(`Missing mandatory file: ${path}`);
	let revision = null;
	try {
		revision = execFileSync(
			'git',
			['-c', `safe.directory=${project.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'],
			{ cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		).trim();
	} catch {
		/* Content hashes remain authoritative. */
	}
	writeFileSync(
		resolve(output, 'release-manifest.json'),
		JSON.stringify(
			{
				version: 1,
				releaseId: id,
				nodeMinimum: '22.17.0',
				buildNode: process.versions.node,
				sourceRevision: revision,
				sourceRevisionIsNotContentIdentity: true,
				files
			},
			null,
			2
		) + '\n'
	);
	verifyRelease(output);
	await releaseArchive(output, [...Object.keys(files), 'release-manifest.json'], archive);
	writeFileSync(archive + '.sha256', `${sha256(readFileSync(archive))}  ${basename(archive)}\n`);
	console.log(
		`Release verified: .releases/${id}\nArchive: .releases/${id}.tar.gz\nProduction packages: ${packages.length}; files: ${Object.keys(files).length}. No secrets or source checkout are packaged.`
	);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
