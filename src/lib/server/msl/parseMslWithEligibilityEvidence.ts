import { MegasquirtCsvParser } from './MegasquirtCsvParser';
import type { LogSession } from '../core/LogSession';

export type CutState = 'active' | 'inactive' | 'unknown' | 'absent';
export type CutObservation = { state: CutState; raw: string | null; sourceLine: number | null };
export type CategoricalEvidence = {
	session: LogSession;
	fuelCut: CutObservation[];
	overrunFuelCut: CutObservation[];
};

/** Opt-in raw evidence sidecar. The existing numeric parser and V1 are unchanged.
 * Accept exactly the same data rows (including malformed-row/marker handling).
 */
export function parseMslWithEligibilityEvidence(content: string, sourcePath = 'memory.msl') {
	const parsed = new MegasquirtCsvParser().parse(content, sourcePath);
	if (!parsed.session) throw new Error(parsed.error);
	const session = parsed.session;
	const lines = content.split(/\r?\n/);
	let index = 0;
	for (; index < lines.length; index++) {
		const line = lines[index].trim();
		if (line && !line.startsWith('"') && line !== '#') break;
	}
	const headers = lines[index]
		.trim()
		.split('\t')
		.map((s) => s.trim());
	const positions = ['status: Fuel Cut', 'status: Overrun Fuel Cut'].map((name) => {
		if (headers.filter((header) => header === name).length > 1)
			throw new Error(`Ambiguous categorical channel: ${name}`);
		return headers.indexOf(name);
	});
	const categorical: CategoricalEvidence = { session, fuelCut: [], overrunFuelCut: [] };
	for (index += 2; index < lines.length; index++) {
		const rawLine = lines[index];
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith('MARK')) continue;
		const tokens = rawLine.split('\t');
		if (tokens.length !== headers.length) continue;
		positions.forEach((position, guard) => {
			const raw = position < 0 ? null : tokens[position].trim();
			const token = raw?.toLowerCase();
			const state: CutState =
				position < 0
					? 'absent'
					: token === 'active'
						? 'active'
						: token === 'inactive'
							? 'inactive'
							: 'unknown';
			(guard === 0 ? categorical.fuelCut : categorical.overrunFuelCut).push({
				state,
				raw,
				sourceLine: index + 1
			});
		});
	}
	if (categorical.fuelCut.length !== session.rowCount)
		throw new Error('Categorical sidecar is not aligned with parsed rows.');
	return { session, categorical };
}
