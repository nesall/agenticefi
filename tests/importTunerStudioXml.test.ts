import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importTunerStudioXml } from '../src/lib/server/msl/importTunerStudioXml';

const fixture = (name: string) =>
	readFileSync(new URL(`./fixtures/xml/${name}.table`, import.meta.url), 'utf8');
const minimal = `<tableData xmlns="http://www.EFIAnalytics.com/:table">
  <bibliography author="A &amp; B" writeDate="today"/>
  <table cols="2" rows="2">
    <xAxis cols="2" name="rpm">1000 6000</xAxis>
    <yAxis rows="2" name="fuelload">30 100</yAxis>
    <zValues cols="2" rows="2">10 20 30 40</zValues>
  </table>
</tableData>`;

describe('real TunerStudio exports', () => {
	it('imports the AFR fixture with known axes, orientation, values, and clamping', () => {
		const result = importTunerStudioXml(fixture('afr'));
		expect(result.xAxisName).toBe('rpm');
		expect(result.yAxisName).toBe('afrload1');
		expect(result.table.columnCount).toBe(12);
		expect(result.table.rowCount).toBe(12);
		expect(result.table.xBreakpoints).toEqual([
			500, 900, 1500, 2200, 3000, 3800, 4600, 5400, 6200, 6800, 7400, 8000
		]);
		expect(result.table.yBreakpoints).toEqual([30, 40, 50, 55, 60, 70, 80, 90, 100, 125, 150, 200]);
		expect(result.table.value(0, 0)).toBeCloseTo(13.2);
		expect(result.table.value(0, 3)).toBeCloseTo(15.2);
		expect(result.table.value(9, 11)).toBeCloseTo(11.2);
		expect(result.table.sample(9000, 125)).toBeCloseTo(11.2);
		expect(result.author).toBe('EFI Analytics - philip.tobin@yahoo.com');
		expect(result.writeDate).toBe('Thu Jul 30 19:41:05 PDT 2026');
	});

	it('imports the VE fixture without transposing or rounding the matrix', () => {
		const result = importTunerStudioXml(fixture('ve'));
		expect(result.xAxisName).toBe('rpm');
		expect(result.yAxisName).toBe('fuelload');
		expect(result.table.columnCount).toBe(16);
		expect(result.table.rowCount).toBe(16);
		expect(result.table.xBreakpoints).toEqual([
			700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000
		]);
		expect(result.table.yBreakpoints).toEqual([
			30, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 125, 150, 175, 200, 260
		]);
		expect(result.table.value(0, 0)).toBe(29.700000000000003);
		expect(result.table.value(0, 1)).toBe(26.8);
		expect(result.table.value(1, 0)).toBe(34.5);
		expect(result.table.value(15, 15)).toBe(237.4);
	});
});

describe('XML syntax and metadata', () => {
	it('accepts an XML declaration with newline-separated attributes', () => {
		expect(importTunerStudioXml(`<?xml\nversion = '1.0'?>${minimal}`).table.values).toEqual([
			[10, 20],
			[30, 40]
		]);
	});
	it('handles prefixes, attribute spacing, entities, comments, CDATA and CRLF', () => {
		const xml = minimal
			.replace('xmlns=', 'xmlns:t=')
			.replace(/<(\/?)(tableData|bibliography|table|xAxis|yAxis|zValues)(?=[\s>])/g, '<$1t:$2')
			.replaceAll('="', " = '")
			.replaceAll('"', "'")
			.replace('1000 6000', '<![CDATA[1000 6000]]>')
			.replace('10 20 30 40', '1&#48; <!-- cell -->2&#x30; 30 40')
			.replaceAll('\n', '\r\n');
		const result = importTunerStudioXml(`\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
		expect(result.author).toBe('A & B');
		expect(result.table.values).toEqual([
			[10, 20],
			[30, 40]
		]);
	});

	it('supports unnamespaced exports and absent optional metadata', () => {
		const xml = minimal
			.replace(' xmlns="http://www.EFIAnalytics.com/:table"', '')
			.replace(/<bibliography[^>]*\/>/, '')
			.replaceAll(/ name="[^"]*"/g, '');
		const result = importTunerStudioXml(xml);
		expect(result.author).toBeUndefined();
		expect(result.writeDate).toBeUndefined();
		expect(result.xAxisName).toBe('x');
		expect(result.yAxisName).toBe('y');
	});

	it.each([
		'',
		minimal.replace('</table>', ''),
		minimal.replace('</table>', '</other>'),
		minimal + '<extra/>',
		'text' + minimal,
		minimal.replace('rows="2"', 'rows=2'),
		minimal.replace('rows="2"', 'rows="2" rows="2"'),
		minimal.replace('A &amp; B', 'A &unknown; B'),
		minimal.replace('A &amp; B', 'A & B'),
		minimal.replace('A &amp; B', '&#0;'),
		minimal.replace('<table cols', '<p:table cols'),
		minimal.replace('http://www.EFIAnalytics.com/:table', 'urn:wrong'),
		minimal.replace('tableData', 'other'),
		minimal.replace('10 20 30 40', '<value>10 20 30 40</value>'),
		minimal.replace('10 20 30 40', '10 20 ]]> 30 40'),
		minimal.replace('10 20 30 40', '<!-- bad -- comment -->10 20 30 40'),
		'<!DOCTYPE tableData [<!ENTITY custom "10">]>' + minimal,
		'<?unsupported instruction?>' + minimal
	])('rejects malformed or unsupported XML case %#', (xml) => {
		expect(() => importTunerStudioXml(xml)).toThrow();
	});
});

describe('table validation', () => {
	it.each(['bad', 'NaN', 'Infinity', '-Infinity', '1e999', '0x10'])(
		'rejects invalid token %s in every numeric section',
		(token) => {
			for (const value of ['1000 6000', '30 100', '10 20 30 40']) {
				expect(() => importTunerStudioXml(minimal.replace(value, `${value} ${token}`))).toThrow(
					/token/
				);
			}
		}
	);

	it('accepts finite decimal and scientific notation', () => {
		expect(
			importTunerStudioXml(minimal.replace('10 20 30 40', '+1e1 2.0e1 .3e2 40.')).table.values
		).toEqual([
			[10, 20],
			[30, 40]
		]);
	});

	it.each(['xAxis', 'yAxis', 'zValues'])('requires exactly one %s', (tag) => {
		const pattern = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`);
		const element = minimal.match(pattern)![0];
		expect(() => importTunerStudioXml(minimal.replace(element, ''))).toThrow();
		expect(() => importTunerStudioXml(minimal.replace(element, element + element))).toThrow();
		expect(() =>
			importTunerStudioXml(minimal.replace(element, element.replace(/>[\s\S]*</, '><')))
		).toThrow();
	});

	it.each([
		['table', 'cols'],
		['table', 'rows'],
		['xAxis', 'cols'],
		['yAxis', 'rows'],
		['zValues', 'cols'],
		['zValues', 'rows']
	])('validates declared %s.%s', (tag, attribute) => {
		const pattern = new RegExp(`(<${tag}\\b[^>]*?)${attribute}="2"`);
		for (const value of ['3', '0', '-1', '2.5', 'NaN']) {
			expect(() =>
				importTunerStudioXml(minimal.replace(pattern, `$1${attribute}="${value}"`))
			).toThrow();
		}
		expect(() => importTunerStudioXml(minimal.replace(pattern, '$1'))).toThrow();
	});

	it.each(['1000', '1000 6000 7000', '6000 1000', '1000 1000'])(
		'rejects mismatched/invalid X axis %s',
		(axis) => {
			expect(() => importTunerStudioXml(minimal.replace('1000 6000', axis))).toThrow();
		}
	);
	it.each(['100', '100 30', '30 30'])('rejects mismatched/invalid Y axis %s', (axis) => {
		expect(() => importTunerStudioXml(minimal.replace('30 100', axis))).toThrow();
	});
	it.each(['10 20 30', '10 20 30 40 50'])('rejects mismatched cell count %s', (cells) => {
		expect(() => importTunerStudioXml(minimal.replace('10 20 30 40', cells))).toThrow(/dimensions/);
	});
});
