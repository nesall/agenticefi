import { describe, expect, it } from 'vitest';
import { MegasquirtCsvParser } from '../src/lib/server/msl/MegasquirtCsvParser';

const parse = (content: string) => new MegasquirtCsvParser().parse(content);

describe('MegasquirtCsvParser', () => {
	it.each(['\n', '\r\n'])('parses metadata and aligned samples with %j line endings', (eol) => {
		const content = [
			'"Test format"',
			'"Capture Date: 2026-10-26"',
			'#',
			'Time\tRPM\tAFR',
			's\trpm\tratio',
			'0\t1000\t14.7',
			'0.1\t1200\t14.2',
			''
		].join(eol);
		const { session, error } = new MegasquirtCsvParser().parse(content, 'drive.msl');
		expect(error).toBeUndefined();
		expect(session).not.toBeNull();
		expect(session!.sourcePath).toBe('drive.msl');
		expect(session!.formatInfo).toBe('Test format');
		expect(session!.captureDate).toBe('Capture Date: 2026-10-26');
		expect(session!.rowCount).toBe(2);
		expect(session!.channels.map((ch) => [ch.name, ch.unit])).toEqual([
			['Time', 's'],
			['RPM', 'rpm'],
			['AFR', 'ratio']
		]);
		expect(session!.timeSec()).toEqual([0, 0.1]);
		expect(session!.findChannel('RPM')!.values).toEqual([1000, 1200]);
		expect(session!.findChannel('AFR')!.values).toEqual([14.7, 14.2]);
		expect(session!.channelMapping.rpm).toBe('RPM');
	});

	it.each([
		['', 'File content is empty.'],
		['\n#\n"metadata"', 'Could not find header row in MSL file.'],
		['Time\tRPM', 'File ended after header row (missing units row).']
	])('returns an error for invalid input %j', (content, error) => {
		expect(parse(content)).toEqual({ session: null, error });
	});

	it('preserves interior missing and invalid values as NaN, distinct from zero', () => {
		const { session } = parse('Time\tAFR\tRPM\ns\tratio\trpm\n0\t\t1000\n1\t0\t1100\n2\tbad\t1200');
		expect(session!.findChannel('AFR')!.values).toEqual([NaN, 0, NaN]);
		expect(session!.findChannel('AFR')!.isNumeric).toBe(false);
		expect(session!.findChannel('CLT')).toBeUndefined();
	});

	it.each(['\t14.7\t1000', '0\t14.7\t'])('preserves a row with an empty edge cell: %j', (row) => {
		const { session } = parse(`Time\tAFR\tRPM\ns\tratio\trpm\n${row}`);
		expect(session!.rowCount).toBe(1);
		for (const channel of session!.channels) expect(channel.values).toHaveLength(1);
		const missingChannel = row.startsWith('\t') ? 'Time' : 'RPM';
		expect(session!.findChannel(missingChannel)!.values[0]).toBeNaN();
	});

	it('skips wrong-width rows without misaligning channels', () => {
		const { session } = parse('Time\tRPM\ns\trpm\n0\t1000\n1\n2\t1200\textra\n3\t1300');
		expect(session!.rowCount).toBe(2);
		expect(session!.timeSec()).toEqual([0, 3]);
		expect(session!.findChannel('RPM')!.values).toEqual([1000, 1300]);
	});

	it('recognizes boolean words case-insensitively', () => {
		const rows = ['TRUE', 'yes', 'On', 'FALSE', 'no', 'off'].map((value, i) => `${i}\t${value}`);
		const { session } = parse(['Time\tFlag', 's\tbool', ...rows].join('\n'));
		expect(session!.findChannel('Flag')!.values).toEqual([1, 1, 1, 0, 0, 0]);
		expect(session!.findChannel('Flag')!.isBoolean).toBe(true);
	});

	it('does not classify a mixed boolean/numeric channel as boolean', () => {
		const { session } = parse('Time\tFlag\ns\tbool\n0\ttrue\n1\t2');
		expect(session!.findChannel('Flag')!.values).toEqual([1, 2]);
		expect(session!.findChannel('Flag')!.isBoolean).toBe(false);
	});

	it.each(['Timestamp', 'DateTime'])(
		'parses UTC %s values and preserves invalid timestamps',
		(name) => {
			const { session } = parse(`Time\t${name}\ns\tUTC\n0\t1970-01-01T00:00:01.500Z\n1\tinvalid`);
			const channel = session!.findChannel(name)!;
			expect(channel.isTimestamp).toBe(true);
			expect(channel.values).toEqual([1.5, NaN]);
		}
	);

	it('attaches markers to the preceding sample without counting them as rows', () => {
		const { session } = parse('Time\tRPM\ns\trpm\n0\t1000\nMARK first\n0.1\t1100\nMARK second');
		expect(session!.rowCount).toBe(2);
		expect(session!.annotations.map(({ timeSec, label }) => ({ timeSec, label }))).toEqual([
			{ timeSec: 0, label: 'MARK first' },
			{ timeSec: 0.1, label: 'MARK second' }
		]);
	});

	it('preserves normal sample times', () => {
		expect(parse('Time\nseconds\n0\n0.1\n0.2').session!.timeSec()).toEqual([0, 0.1, 0.2]);
	});

	it('reports bounded, monotonic progress ending at one', () => {
		const progress: number[] = [];
		const rows = Array.from({ length: 2001 }, (_, i) => `${i}\t1000`);
		new MegasquirtCsvParser().parse(
			['Time\tRPM', 's\trpm', ...rows].join('\n'),
			'progress.msl',
			(p) => progress.push(p)
		);
		expect(progress.length).toBeGreaterThan(1);
		expect(progress.at(-1)).toBe(1);
		progress.forEach((p, i) => {
			expect(p).toBeGreaterThanOrEqual(i === 0 ? 0 : progress[i - 1]);
			expect(p).toBeLessThanOrEqual(1);
		});
	});
});
