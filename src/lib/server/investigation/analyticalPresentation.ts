import type { AnalyticalPresentation } from '../../shared/types/analyticalDashboard';
import type { VeEvaluationDataset, VeCandidateEvaluation } from '../../shared/types/veEvaluation';
import type { VeFitResult } from '../../shared/types/veFitting';
import { summarizeAfrErrorRows } from '../analysis/targetAfrError';
import { assertCoverageSupport } from './coverageConsistency';

/** Read-only worker projection. No fitting, prediction, membership changes or new formulas. */
export function analyticalPresentation(
	profile: string,
	dataset?: VeEvaluationDataset,
	fit?: VeFitResult,
	evaluation?: VeCandidateEvaluation
): AnalyticalPresentation {
	if (fit && (!dataset || fit.datasetId !== dataset.datasetId))
		throw new Error('Analytical presentation dataset identity mismatch.');
	assertCoverageSupport(
		dataset?.coverage,
		fit?.cells.filter((cell) => cell.status !== 'unsupported').length
	);
	const groups = new Map<string, VeEvaluationDataset['rows'][number][]>();
	for (const row of dataset?.rows ?? []) {
		if (row.partition !== 'training' || row.status !== 'ready' || row.ve.location.status !== 'ok')
			continue;
		const n = row.ve.location.neighborhood,
			key = `${n.rpmIndex},${n.mapIndex}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(row);
	}
	const regions = [...groups.values()]
		.map((rows) => {
			const n = rows[0].ve.location;
			if (n.status !== 'ok') throw new Error('Missing region.');
			const summary = summarizeAfrErrorRows(rows.map((row) => row.afr));
			return {
				rpmIndex: n.neighborhood.rpmIndex,
				mapIndex: n.neighborhood.mapIndex,
				rpmBounds: [...n.neighborhood.rpmBounds],
				mapBoundsKpa: [...n.neighborhood.mapBoundsKpa],
				summary,
				samples: [
					...new Set(
						Object.values(summary.supportingRows).filter((row): row is number => row !== null)
					)
				]
					.slice(0, 3)
					.map((row) => {
						const a = dataset!.rows[row].afr;
						return {
							rowIndex: row,
							timeSec: a.timeSec,
							rpm: a.rpm,
							mapKpa: a.mapKpa,
							measuredAfr: a.measuredAfr,
							targetAfr: a.target.value
						};
					})
			};
		})
		.sort(
			(a, b) =>
				b.summary.error.count - a.summary.error.count ||
				a.rpmIndex - b.rpmIndex ||
				a.mapIndex - b.mapIndex
		);
	const table = dataset?.tables.ve;
	const cells = (fit?.cells ?? []).map((cell) => ({
		rpmIndex: cell.rpmIndex,
		mapIndex: cell.mapIndex,
		status: cell.status,
		reasons: [...cell.reasons],
		finalCorrectionPct: cell.finalCorrectionPct,
		atBound: cell.atBound,
		materialTrainingSamples: cell.materialTrainingSamples,
		rpm: table!.provenance.rpmAxis[cell.rpmIndex],
		mapKpa: table!.provenance.mapAxisKpa[cell.mapIndex],
		originalVe: table!.values[cell.mapIndex][cell.rpmIndex],
		proposedVe: fit!.candidate.values[cell.mapIndex][cell.rpmIndex]
	}));
	const result: AnalyticalPresentation = {
		veAxes: table
			? { rpm: [...table.provenance.rpmAxis], mapKpa: [...table.provenance.mapAxisKpa] }
			: undefined,
		datasetId: dataset?.datasetId ?? null,
		profile,
		coverage: dataset ? structuredClone(dataset.coverage) : null,
		regions,
		cells,
		paired: evaluation ? structuredClone(evaluation.paired) : null,
		affectedOnly: evaluation ? structuredClone(evaluation.affectedOnly) : null,
		limitations: [
			...new Set([
				...(dataset?.limitations ?? []),
				...(fit?.limitations ?? []),
				...(evaluation?.limitations ?? [])
			])
		],
		omittedRegions: 0,
		omittedCells: 0
	};
	if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
		throw new Error('Dashboard projection byte budget exceeded.');
	return result;
}
