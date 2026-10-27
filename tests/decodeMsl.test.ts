import { describe, expect, it } from 'vitest';
import { decodeMsl } from '../src/lib/server/msl/decodeMsl';

describe('MSL byte decoding', () => {
	it.each(['Time\tRPM\ns\trpm\n0\t1000', 'CLT\tMAT\n°C\t°F\n80\t176', 'λ café'])(
		'preserves valid UTF-8 text %j',
		(content) => {
			expect(decodeMsl(Buffer.from(content, 'utf8'))).toEqual({
				content,
				encoding: 'utf-8',
				usedFallback: false
			});
		}
	);
	it('preserves legacy degree symbols using recorded Windows-1252 fallback', () => {
		const bytes = Buffer.from('CLT\tMAT\n\xb0F\t\xb0C\n212\t100', 'latin1');
		expect(decodeMsl(bytes)).toEqual({
			content: 'CLT\tMAT\n°F\t°C\n212\t100',
			encoding: 'windows-1252',
			usedFallback: true
		});
	});
	it('decodes Windows-1252 punctuation rather than treating it as Latin-1 controls', () => {
		expect(decodeMsl(new Uint8Array([0x93, 0x41, 0x94])).content).toBe('“A”');
	});
	it('handles a UTF-8 BOM without falling back', () => {
		expect(decodeMsl(Buffer.from('\uFEFFTime\ns\n0', 'utf8'))).toEqual({
			content: 'Time\ns\n0',
			encoding: 'utf-8',
			usedFallback: false
		});
	});
	it('does not guess replacements for text that was already corrupted upstream', () => {
		expect(decodeMsl(Buffer.from('�F', 'utf8'))).toEqual({
			content: '�F',
			encoding: 'utf-8',
			usedFallback: false
		});
	});
});
