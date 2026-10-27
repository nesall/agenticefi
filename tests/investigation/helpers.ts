import { readFileSync } from 'node:fs';
import { createInvestigationContext } from '../../src/lib/server/investigation/context';
import type { InvestigationModel } from '../../src/lib/shared/types/investigation';

export const veXml = readFileSync(new URL('../fixtures/xml/ve.table', import.meta.url), 'utf8');
export const afrXml = readFileSync(new URL('../fixtures/xml/afr.table', import.meta.url), 'utf8');

export function context(rows = ['0\t1000\t100\t14', '1\t2000\t\t15', '2\t3000\t200\tbad']) {
	return createInvestigationContext({
		id: 'synthetic',
		logName: 'synthetic.msl',
		calibrationId: 'test-calibration',
		veXml,
		afrXml,
		logContent: ['Time\tRPM\tMAP\tAFR', 's\trpm\tkPa\tAFR', ...rows].join('\n')
	});
}

export const tool = (name: string, args: unknown = {}) => ({ kind: 'tool', name, arguments: args });
export const final = (evidenceIds = ['evidence-1']) => ({
	kind: 'final',
	findings: [{ statement: 'The tool returned data-quality evidence.', evidenceIds }],
	limitations: ['Data quality does not establish tuning eligibility.']
});
export function scripted(...turns: unknown[]): InvestigationModel {
	let index = 0;
	return {
		async next() {
			if (index >= turns.length) throw new Error('Script exhausted.');
			return turns[index++];
		}
	};
}
