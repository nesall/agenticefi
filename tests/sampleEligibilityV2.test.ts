import { describe, expect, it } from 'vitest';
import {
	classifyExperimentalEligibility as classify,
	experimentalConfig,
	rpmWindowMetrics
} from '../src/lib/server/analysis/sampleEligibilityV2';
import { classifySampleEligibility } from '../src/lib/server/analysis/sampleEligibility';
import { parseMslWithEligibilityEvidence } from '../src/lib/server/msl/parseMslWithEligibilityEvidence';

function log(edit: (cells: string[], row: number) => void = () => {}, count = 61) {
	const rows = Array.from({ length: count }, (_, i) => {
		const cells = [
			(i / 10).toString(),
			'2000',
			'50',
			'14',
			'185',
			'100',
			'10',
			'0',
			'0',
			'3',
			'Inactive',
			'Inactive'
		];
		edit(cells, i);
		return cells.join('\t');
	});
	return parseMslWithEligibilityEvidence(
		'"test"\n#\nTime\tRPM\tMAP\tAFR\tCLT\tFuel: Warmup cor\tTPS\tTPSdot\tMAPdot\tPW\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\ns\trpm\tkPa\tAFR\t°F\t%\t%\t%/s\tkPa/s\tms\t\t\n' +
			rows.join('\n')
	);
}
const run = (input = log(), config: Parameters<typeof classify>[1] = {}) =>
	classify(input.session, { categorical: input.categorical, ...config });
const codes = (sample: ReturnType<typeof classify>['samples'][number]) =>
	[...sample.baseReasons, ...sample.reasons].map((r) => r.code);

describe('experimental RPM mathematics', () => {
	it('uses all pair slopes and linearly interpolated quantiles on irregular times', () => {
		expect(rpmWindowMetrics([0, 0.1, 0.4, 1], [1000, 1010, 1040, 1100])).toEqual({
			slopeRpmPerSec: 100,
			centralSpreadRpm: 79,
			rangeRpm: 100
		});
		expect(() => rpmWindowMetrics([0, 0], [1, 2])).toThrow();
	});
	it.each([NaN, Infinity, -1])('rejects invalid thresholds %s', (value) => {
		expect(() => experimentalConfig({ maxRangeRpm: value })).toThrow();
	});
	it('validates enums, booleans, observation counts and unknown options', () => {
		for (const config of [
			{ minObservations: 1 },
			{ minObservations: 2.5 },
			{ windowSec: 0 },
			{ rpmMethod: 'other' },
			{ requireFuelCutEvidence: 1 },
			{ typo: 2 }
		])
			expect(() => experimentalConfig(config as never)).toThrow();
	});
});

describe('experimental eligibility controls', () => {
	it.each(['adjacent', 'windowed'] as const)(
		'has complete support for stable RPM: %s × trailing/centered',
		(rpmMethod) => {
			for (const windowAlignment of ['trailing', 'centered'] as const) {
				const result = run(log(), { config: { rpmMethod, windowAlignment } });
				expect(result.samples[30].status).toBe('eligible');
				expect(result.samples[0].status).toBe('indeterminate');
				expect(
					result.samples[30].window!.actualEndSec! - result.samples[30].window!.actualStartSec!
				).toBeGreaterThanOrEqual(1);
				expect(result.samples[60].status).toBe(
					windowAlignment === 'centered' ? 'indeterminate' : 'eligible'
				);
			}
		}
	);
	it('recovers bounded jitter while rejecting smooth acceleration and deceleration', () => {
		const jitter = log((cells, row) => {
			cells[1] = String(2000 + (row % 2 ? 15 : -15));
		});
		expect(run(jitter).samples[30].status).toBe('eligible');
		expect(run(jitter, { config: { rpmMethod: 'adjacent' } }).samples[30].status).toBe(
			'heuristic-excluded'
		);
		for (const slope of [-300, 300]) {
			const result = run(
				log((cells, row) => {
					cells[1] = String(4000 + (slope * row) / 10);
				})
			);
			expect(codes(result.samples[30])).toContain('RPM_WINDOW_SLOPE');
		}
	});
	it('bounds oscillation and raw range even when robust slope is near zero', () => {
		const result = run(
			log((cells, row) => {
				cells[1] = String(2000 + 85 * Math.sin((row * Math.PI) / 10));
			})
		);
		expect(codes(result.samples[30])).toContain('RPM_WINDOW_RANGE');
		expect(codes(result.samples[30])).toContain('RPM_WINDOW_SPREAD');
	});
	it('preserves a jump boundary reason even when there is no usable window', () => {
		const result = run(
			log((cells, row) => {
				if (row >= 30) cells[1] = '2200';
			})
		);
		expect(codes(result.samples[30])).toContain('RPM_JUMP_BOUNDARY');
		expect(result.samples[30].window).toBeNull();
		expect(result.samples[28].status).toBe('indeterminate');
		expect(result.samples[32].status).toBe('indeterminate');
	});
	it('treats missing RPM as unsupported core evidence, never a numerical jump', () => {
		const result = run(
			log((cells, row) => {
				if (row === 30) cells[1] = '';
			})
		);
		expect(codes(result.samples[30])).toContain('RPM_UNUSABLE');
		expect(codes(result.samples[30])).not.toContain('RPM_JUMP_BOUNDARY');
		expect(codes(result.samples[31])).not.toContain('RPM_JUMP_BOUNDARY');
		expect(result.samples[29].status).toBe('indeterminate');
	});
	it.each([10, 11] as const)(
		'preserves categorical guard %s independently and blocks crossing an active transition',
		(column) => {
			const result = run(
				log((cells, row) => {
					if (row === 30) cells[column] = 'Active';
				})
			);
			expect(codes(result.samples[30])).toContain(
				column === 10 ? 'FUEL_CUT_ACTIVE' : 'OVERRUN_FUEL_CUT_ACTIVE'
			);
			expect(result.samples[30].status).toBe('heuristic-excluded');
			expect(result.samples[29].status).toBe('indeterminate');
			expect(result.samples[31].status).toBe('indeterminate');
		}
	);
	it('unknown and absent guards are indeterminate when required, otherwise unassessed; Active always excludes', () => {
		const input = log((cells) => {
			cells[10] = '?';
		});
		expect(run(input).samples[30].status).toBe('indeterminate');
		const optional = run(input, { config: { requireFuelCutEvidence: false } }).samples[30];
		expect(optional.status).toBe('eligible');
		expect(optional.categorical.fuelCut.state).toBe('unknown');
		expect(optional.reasons.find((r) => r.code === 'FUEL_CUT_UNASSESSED')!.blocking).toBe(false);
		expect(classify(input.session).samples[30].status).toBe('indeterminate');
		expect(
			run(
				log((cells) => {
					cells[11] = 'Active';
				}),
				{ config: { requireOverrunFuelCutEvidence: false } }
			).samples[30].status
		).toBe('heuristic-excluded');
	});
	it.each([
		['coolant', 4, '100', 'COOLANT_BELOW_MINIMUM'],
		['warmup', 5, '105', 'WARMUP_CORRECTION_ACTIVE'],
		['TPS', 7, '20', 'TPS_TRANSIENT'],
		['MAP', 8, '20', 'MAP_TRANSIENT'],
		['AFR', 3, '', 'AFR_UNUSABLE']
	] as const)('retains base %s rule and blocks windows', (_, column, value, code) => {
		const result = run(
			log((cells, row) => {
				if (row === 30) cells[column] = value;
			})
		);
		expect(codes(result.samples[30])).toContain(code);
		expect(result.samples[29].status).toBe('indeterminate');
	});
	it('retains numeric possible fuel cut independently of inactive flags', () => {
		const result = run(
			log((cells, row) => {
				if (row === 30) {
					cells[9] = '0';
					cells[6] = '0';
				}
			})
		);
		expect(codes(result.samples[30])).toContain('POSSIBLE_FUEL_CUT');
		expect(result.samples[30].categorical.fuelCut.state).toBe('inactive');
	});
	it.each(['duplicate', 'reverse', 'gap', 'invalid'] as const)(
		'does not cross %s time evidence',
		(kind) => {
			const result = run(
				log((cells, row) => {
					if (row === 30)
						cells[0] =
							kind === 'duplicate'
								? '2.9'
								: kind === 'reverse'
									? '2'
									: kind === 'invalid'
										? ''
										: '4';
				})
			);
			expect(result.samples[30].status).not.toBe('eligible');
			expect(result.samples[29].status).toBe('indeterminate');
		}
	);
	it('does not use observations outside a declared partition or mutate V1', () => {
		const input = log();
		const before = JSON.stringify(classifySampleEligibility(input.session));
		const result = run(input, { partition: { startRow: 20, endRowExclusive: 41 } });
		expect(result.samples).toHaveLength(21);
		expect(result.samples[0].status).toBe('indeterminate');
		expect(result.samples[10].status).toBe('eligible');
		expect(result.samples[20].status).toBe('indeterminate');
		expect(JSON.stringify(classifySampleEligibility(input.session))).toBe(before);
		expect(() => run(input, { categorical: log().categorical })).toThrow();
	});
	it('preserves sidecar row alignment with malformed rows, markers, CRLF and empty edge cells', () => {
		const content =
			'#\r\nTime\tstatus: Fuel Cut\tstatus: Overrun Fuel Cut\r\ns\t\t\r\n0\tActive\tInactive\r\nMARK 1\r\nbad\twidth\r\n1\tInactive\t\r\n';
		const { session, categorical } = parseMslWithEligibilityEvidence(content);
		expect(session.rowCount).toBe(2);
		expect(categorical.fuelCut.map((v) => v.state)).toEqual(['active', 'inactive']);
		expect(categorical.overrunFuelCut[1]).toMatchObject({
			state: 'unknown',
			raw: '',
			sourceLine: 7
		});
		expect(session.findChannel('status: Fuel Cut')!.values.every(Number.isNaN)).toBe(true);
	});
	it('passes exact numeric bounds and rejects just beyond them', () => {
		const input = log((cells, row) => {
			cells[1] = String(2000 + row * 10);
		});
		const exact = run(input).samples[30].window!;
		const thresholds = {
			maxAbsSlopeRpmPerSec: exact.slopeRpmPerSec!,
			maxCentralSpreadRpm: exact.centralSpreadRpm!,
			maxRangeRpm: exact.rangeRpm!
		};
		expect(run(input, { config: thresholds }).samples[30].status).toBe('eligible');
		expect(
			codes(
				run(input, { config: { ...thresholds, maxRangeRpm: exact.rangeRpm! - 0.001 } }).samples[30]
			)
		).toContain('RPM_WINDOW_RANGE');
		const step = log((cells, row) => {
			if (row >= 30) cells[1] = '2050';
		});
		expect(codes(run(step).samples[30])).not.toContain('RPM_JUMP_BOUNDARY');
		expect(codes(run(step, { config: { maxAdjacentJumpRpm: 49.999 } }).samples[30])).toContain(
			'RPM_JUMP_BOUNDARY'
		);
	});
	it('does not pad sparse support or excessive endpoint brackets', () => {
		const sparse = log((cells, row) => {
			cells[0] = String(row * 0.25);
		});
		expect(run(sparse).samples[30].status).not.toBe('eligible');
		expect(codes(run(log(), { config: { minObservations: 20 } }).samples[30])).toContain(
			'STABILITY_SUPPORT_UNASSESSED'
		);
		expect(
			codes(run(log(), { config: { windowSec: 1.01, maxEndpointBracketSec: 0.01 } }).samples[30])
		).toContain('STABILITY_SUPPORT_UNASSESSED');
	});
	it('does not cross a stitch or a supported observation gap', () => {
		const input = log();
		input.session.discontinuities.push({ rowIndex: 30, cause: 'StitchPoint' } as never);
		const stitched = run(input);
		expect(codes(stitched.samples[30])).toContain('STITCH_BOUNDARY');
		expect(stitched.samples[29].status).toBe('indeterminate');
		const gap = run(
			log((cells, row) => {
				if (row >= 30) cells[0] = String(row / 10 + 0.3);
			})
		);
		expect(codes(gap.samples[30])).toContain('OBSERVATION_GAP');
		expect(gap.samples[29].status).toBe('indeterminate');
	});
	it('does not let held-out values alter the declared partition', () => {
		const partition = { startRow: 10, endRowExclusive: 41 };
		const ordinary = run(log(), { partition });
		const changed = run(
			log((cells, row) => {
				if (row > 40) {
					cells[1] = '9000';
					cells[10] = 'Active';
				}
			}),
			{ partition }
		);
		expect(changed).toEqual(ordinary);
	});
});
