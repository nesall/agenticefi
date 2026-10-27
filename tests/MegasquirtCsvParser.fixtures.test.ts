import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MegasquirtCsvParser } from '../src/lib/server/msl/MegasquirtCsvParser';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'msl');
function findLogs(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry: Dirent) => {
			const path = join(directory, entry.name);
			return entry.isDirectory()
				? findLogs(path)
				: entry.isFile() && /\.msl$/i.test(entry.name)
					? [path]
					: [];
		})
		.sort();
}
const files = findLogs(fixtureDirectory);

describe('real MSL fixtures', () => {
	it('contains at least one real .msl file', () => {
		expect(
			files.length,
			'Place real .msl files in tests/fixtures/msl/ before running the fixture suite.'
		).toBeGreaterThan(0);
	});

	for (const path of files) {
		it(`parses ${relative(fixtureDirectory, path)} consistently with aligned samples`, () => {
			const content = readFileSync(path, 'utf8');
			const parser = new MegasquirtCsvParser();
			const { session, error } = parser.parse(content, path);
			expect(error).toBeUndefined();
			expect(session).not.toBeNull();
			expect(session!.rowCount).toBeGreaterThan(0);
			expect(session!.channels.length).toBeGreaterThan(0);
			for (const channel of session!.channels) {
				expect(channel.values, channel.name).toHaveLength(session!.rowCount);
			}
			expect(parser.parse(content, path).session).toEqual(session);
		});
	}
});
