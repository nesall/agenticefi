import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';
import { importTunerStudioXml } from '../src/lib/server/msl/importTunerStudioXml';
import { classifySampleEligibility } from '../src/lib/server/analysis/sampleEligibility';
import { classifyExperimentalEligibility } from '../src/lib/server/analysis/sampleEligibilityV2';
import type { ExperimentalSample } from '../src/lib/shared/types/sampleEligibilityV2';

const datasets = [
	['block1/2025-04-12_16.16.28.msl', 'src/lib/server/demo/ve.table', [0, 2043, 1, 815]],
	['block1/2026-07-25_17.56.47.msl', 'src/lib/server/demo/ve.table', [2, 12944, 2, 6042]],
	[
		'block3/2026-08-01_09.45.13.msl',
		'data/logs/block3/veTable1Tbl_2026-08-02_00.24.28.table',
		[345, 22494, 6, 6805]
	],
	[
		'block2/2026-08-08_11.19.56.msl',
		'data/logs/block2/veTable1_2026-08-08_23.57.53.table',
		[8, 38528, 3, 17745]
	]
] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

it('compares the fixed 2×2 controls on all four real logs and preserves complete V1 outputs', () => {
	const reports = [];
	for (const [file, tablePath, expected] of datasets) {
		const bytes = readFileSync(`data/logs/${file}`);
		const { session, categorical } = parseMslWithEligibilityEvidence(
			decodeMsl(bytes).content,
			file
		);
		const baseline = classifySampleEligibility(session);
		expect(Object.values(baseline.summary.statuses)).toEqual(expected);
		const fingerprint = hash(baseline);
		const table = importTunerStudioXml(readFileSync(tablePath, 'utf8')).table;
		const rpmAxis = table.xBreakpoints,
			mapAxis = table.yBreakpoints;
		const rpm = session.findChannel('RPM')!.values,
			map = session.findChannel('MAP')!.values;
		const tps = session.findChannel('TPS')!.values,
			afr = session.findChannel('AFR')!.values;
		const speed = session.findChannel('VSS1')?.values,
			barometer = session.findChannel('Barometer')?.values;
		const region = (row: number) => {
			if (!(rpm[row] > 0 && map[row] > 0 && Number.isFinite(tps[row]))) return 'unusable';
			if (!Number.isFinite(barometer?.[row])) return 'barometer-unavailable';
			if (map[row] > barometer![row]) return 'boost';
			if (map[row] >= 70) return 'moderate-load';
			if (rpm[row] < 1500 && tps[row] <= 2 && (!speed || speed[row] <= 1)) return 'idle-like';
			if (speed && speed[row] > 1 && tps[row] > 2) return 'cruise-like';
			return tps[row] <= 2 ? 'closed-throttle/non-idle' : 'low-load/motion-unverified';
		};
		const bin = (axis: number[], value: number) =>
			Math.max(
				0,
				Math.min(
					axis.length - 2,
					axis.findIndex((v) => v > value) - 1 < 0
						? value >= axis.at(-1)!
							? axis.length - 2
							: 0
						: axis.findIndex((v) => v > value) - 1
				)
			);
		const coverage = (samples: { rowIndex: number; status: string }[]) => {
			const neighborhoods: Record<string, number> = {},
				regions: Record<string, { available: number; accepted: number }> = {};
			const rpmBands = Array(rpmAxis.length - 1).fill(0),
				mapBands = Array(mapAxis.length - 1).fill(0);
			let clamped = 0;
			for (const sample of samples) {
				const row = sample.rowIndex,
					key = region(row);
				regions[key] ??= { available: 0, accepted: 0 };
				regions[key].available++;
				if (sample.status !== 'eligible') continue;
				regions[key].accepted++;
				const x = bin(rpmAxis, rpm[row]),
					y = bin(mapAxis, map[row]);
				neighborhoods[`${x},${y}`] = (neighborhoods[`${x},${y}`] ?? 0) + 1;
				rpmBands[x]++;
				mapBands[y]++;
				if (
					rpm[row] < rpmAxis[0] ||
					rpm[row] > rpmAxis.at(-1)! ||
					map[row] < mapAxis[0] ||
					map[row] > mapAxis.at(-1)!
				)
					clamped++;
			}
			return {
				occupiedNeighborhoods: Object.keys(neighborhoods).length,
				neighborhoods,
				rpmBands,
				mapBands,
				regions,
				clamped
			};
		};
		const changedIntervals = (samples: ExperimentalSample[]) => {
			const intervals: { direction: string; startRow: number; endRow: number }[] = [];
			for (const sample of samples) {
				const old = baseline.samples[sample.rowIndex].status === 'eligible',
					current = sample.status === 'eligible';
				if (old === current) continue;
				const direction = current ? 'gained' : 'lost',
					last = intervals.at(-1);
				if (last && last.direction === direction && last.endRow === sample.rowIndex - 1)
					last.endRow++;
				else intervals.push({ direction, startRow: sample.rowIndex, endRow: sample.rowIndex });
			}
			return ['gained', 'lost'].flatMap((direction) =>
				intervals
					.filter((i) => i.direction === direction)
					.sort((a, b) => b.endRow - b.startRow - (a.endRow - a.startRow))
					.slice(0, 5)
					.map((interval) => {
						const { startRow: start, endRow: end } = interval;
						const range = (values: number[]) => ({
							min: Math.min(...values.slice(start, end + 1)),
							max: Math.max(...values.slice(start, end + 1))
						});
						const middle = Math.floor((start + end) / 2);
						return {
							...interval,
							sampleCount: end - start + 1,
							timeStartSec: samples[start].timeSec,
							timeEndSec: samples[end].timeSec,
							rpm: range(rpm),
							mapKpa: range(map),
							tpsPct: range(tps),
							afr: range(afr),
							representativeRow: middle,
							representativeV1: baseline.samples[middle],
							representativeV2: samples[middle]
						};
					})
			);
		};
		const controls = [];
		const acceptedSets = new Map<string, Set<number>>();
		for (const rpmMethod of ['adjacent', 'windowed'] as const)
			for (const windowAlignment of ['trailing', 'centered'] as const) {
				const result = classifyExperimentalEligibility(session, {
					categorical,
					config: { rpmMethod, windowAlignment }
				});
				acceptedSets.set(
					`${rpmMethod}-${windowAlignment}`,
					new Set(result.samples.filter((s) => s.status === 'eligible').map((s) => s.rowIndex))
				);
				const transitions: Record<string, number> = {};
				for (const sample of result.samples) {
					const key = `${baseline.samples[sample.rowIndex].status} -> ${sample.status}`;
					transitions[key] = (transitions[key] ?? 0) + 1;
					if (sample.status === 'eligible') {
						expect(sample.baseReasons).toHaveLength(0);
						expect(sample.reasons.some((r) => r.blocking)).toBe(false);
						expect(sample.categorical.fuelCut.state).toBe('inactive');
						expect(sample.categorical.overrunFuelCut.state).toBe('inactive');
						expect(sample.window!.observationCount).toBeGreaterThanOrEqual(9);
					}
				}
				expect(Object.values(result.summary.statuses).reduce((a, b) => a + b, 0)).toBe(
					session.rowCount
				);
				controls.push({
					name: `${rpmMethod}-${windowAlignment}`,
					config: result.config,
					baseConfig: result.baseConfig,
					summary: result.summary,
					coverage: coverage(result.samples),
					transitionsFromV1: transitions,
					changedIntervals: changedIntervals(result.samples)
				});
			}
		expect(hash(classifySampleEligibility(session))).toBe(fingerprint);
		const factorTransitions = [
			['adjacent-trailing', 'windowed-trailing'],
			['adjacent-centered', 'windowed-centered'],
			['adjacent-trailing', 'adjacent-centered'],
			['windowed-trailing', 'windowed-centered']
		].map(([from, to]) => {
			const a = acceptedSets.get(from)!,
				b = acceptedSets.get(to)!;
			return {
				from,
				to,
				retained: [...a].filter((row) => b.has(row)).length,
				gained: [...b].filter((row) => !a.has(row)).length,
				lost: [...a].filter((row) => !b.has(row)).length
			};
		});
		const report = {
			file,
			sourceSha256: createHash('sha256').update(bytes).digest('hex'),
			tablePath,
			rpmAxis,
			mapAxis,
			rowCount: session.rowCount,
			v1: { fingerprint, summary: baseline.summary, coverage: coverage(baseline.samples) },
			controls,
			factorTransitions
		};
		reports.push(report);
		console.info(
			file,
			JSON.stringify({
				v1: baseline.summary.statuses,
				controls: controls.map((c) => ({
					name: c.name,
					statuses: c.summary.statuses,
					occupied: c.coverage.occupiedNeighborhoods,
					regions: c.coverage.regions
				}))
			})
		);
	}
	if (process.env.WRITE_ELIGIBILITY_V2_REPORT === '1') {
		mkdirSync('reports/steady-afr-ve-v2-comparison', { recursive: true });
		writeFileSync(
			'reports/steady-afr-ve-v2-comparison/findings.json',
			JSON.stringify(reports, null, 2) + '\n'
		);
	}
}, 120000);
