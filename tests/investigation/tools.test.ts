import { describe, expect, it } from 'vitest';
import { createInvestigationContext } from '../../src/lib/server/investigation/context';
import { executeInvestigationTool as execute } from '../../src/lib/server/investigation/tools';
import { context, veXml, afrXml } from './helpers';

describe('investigation context', () => {
	it('loads associated real calibration matrices and preserves explicit provenance', () => {
		const c = context();
		expect(c.ve.table.rowCount).toBe(16);
		expect(c.afr.table.rowCount).toBe(12);
		expect(c.calibrationId).toBe('test-calibration');
		expect(c.limitations.join(' ')).toContain('correct the first timestamp');
	});
	it('rejects empty logs and invalid calibration inputs', () => {
		expect(() => context([])).toThrow('no samples');
		expect(() =>
			createInvestigationContext({
				id: 'a',
				logName: 'a',
				calibrationId: 'b',
				veXml: 'bad',
				afrXml,
				logContent: 'Time\ns\n0'
			})
		).toThrow();
	});
});

describe('analytical tools', () => {
	it('describes parsed bounds and resolutions with calibration metadata', () => {
		const result = execute(context(), 'describe_log', {});
		expect(result).toMatchObject({
			ok: true,
			data: {
				rowCount: 3,
				time: { startSec: 0, endSec: 2 },
				calibration: [
					{ kind: 've', rows: 16, columns: 16 },
					{ kind: 'afr', rows: 12, columns: 12 }
				]
			}
		});
		expect(JSON.stringify(result)).toContain('test-calibration');
	});
	it('computes inclusive-window statistics and counts invalid samples', () => {
		const result = execute(context(), 'summarize_window', {
			startSec: 0,
			endSec: 2,
			slots: ['rpm', 'load', 'afr', 'clt']
		});
		expect(result).toMatchObject({
			ok: true,
			data: {
				sampleCount: 3,
				firstRowIndex: 0,
				lastRowIndex: 2,
				statistics: [
					{ slot: 'rpm', validCount: 3, min: 1000, max: 3000, mean: 2000 },
					{ slot: 'load', validCount: 2, unavailableCount: 1, min: 100, max: 200, mean: 150 },
					{ slot: 'afr', validCount: 2, unavailableCount: 1, mean: 14.5 },
					{ slot: 'clt', validCount: 0, unavailableCount: 3, min: null, max: null, mean: null }
				]
			}
		});
	});
	it('normalizes units before computing statistics', () => {
		const c = createInvestigationContext({
			id: 'a',
			logName: 'a',
			calibrationId: 'b',
			veXml,
			afrXml,
			logContent: 'Time\tMAP\ns\tbar\n0\t1\n1\t2'
		});
		expect(
			execute(c, 'summarize_window', { startSec: 0, endSec: 1, slots: ['load'] })
		).toMatchObject({
			ok: true,
			data: {
				statistics: [
					{ min: 100, max: 200, mean: 150, resolution: { unit: 'kPa', sourceUnit: 'bar' } }
				]
			}
		});
	});
	it('returns null statistics for an empty window without inventing samples', () => {
		expect(
			execute(context(), 'summarize_window', { startSec: 20, endSec: 30, slots: ['rpm'] })
		).toMatchObject({
			ok: true,
			data: {
				sampleCount: 0,
				firstRowIndex: null,
				lastRowIndex: null,
				statistics: [{ validCount: 0, mean: null, min: null, max: null }]
			}
		});
	});
	it('counts invalid, duplicate and reversed timestamps independently', () => {
		const c = context([
			'0\t1000\t100\t14',
			'1\t1000\t100\t14',
			'1\t1000\t100\t14',
			'0\t1000\t100\t14',
			'bad\t1000\t100\t14',
			'4\t1000\t100\t14'
		]);
		expect(execute(c, 'assess_data_quality', {})).toMatchObject({
			ok: true,
			data: { invalidTimeCount: 1, duplicateTimeCount: 1, timeInversionCount: 1 }
		});
		expect(
			execute(c, 'summarize_window', { startSec: 0, endSec: 4, slots: ['rpm'] })
		).toMatchObject({ ok: true, data: { sampleCount: 5, excludedInvalidTimeCount: 1 } });
	});
	it('refuses time-window selection without explicit seconds units', () => {
		const c = createInvestigationContext({
			id: 'a',
			logName: 'a',
			calibrationId: 'b',
			veXml,
			afrXml,
			logContent: 'Time\tRPM\nms\trpm\n0\t1000'
		});
		expect(execute(c, 'summarize_window', { startSec: 0, endSec: 1, slots: ['rpm'] }).ok).toBe(
			false
		);
		expect(execute(c, 'assess_data_quality', {})).toMatchObject({
			ok: true,
			data: { timeAvailable: false, invalidTimeCount: null }
		});
	});
	it.each([
		null,
		[],
		{},
		{ startSec: 2, endSec: 1, slots: ['rpm'] },
		{ startSec: NaN, endSec: 1, slots: ['rpm'] },
		{ startSec: 0, endSec: Infinity, slots: ['rpm'] },
		{ startSec: 0, endSec: 1, slots: [] },
		{ startSec: 0, endSec: 1, slots: ['rpm', 'rpm'] },
		{ startSec: 0, endSec: 1, slots: ['__proto__'] },
		{ startSec: 0, endSec: 1, slots: ['rpm'], extra: true }
	])('rejects invalid window arguments %#', (args) => {
		expect(execute(context(), 'summarize_window', args).ok).toBe(false);
	});
	it('rejects unknown tools and extra arguments to no-argument tools', () => {
		expect(execute(context(), 'write_ecu', {}).ok).toBe(false);
		expect(execute(context(), 'describe_log', { extra: 1 }).ok).toBe(false);
		expect(execute(context(), 'assess_data_quality', { extra: 1 }).ok).toBe(false);
	});
});
