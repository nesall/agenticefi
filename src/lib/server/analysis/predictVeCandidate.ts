import type {
	ManualVeCandidate,
	ManualVeChange,
	PairedVeMetrics,
	VeCandidateContent,
	VeCandidateEvaluation,
	VeErrorMetrics,
	VeEvaluationDataset,
	VePredictionRow
} from '../../shared/types/veEvaluation';
import { afrErrorStatistics } from './targetAfrError';
import { interpolateVe } from './veInterpolation';
import { freezeVeArtifact, veContentHash, verifyVeDataset } from './veArtifacts';

/** Manual bounded vector only. Omitted and unsupported cells stay unchanged. */
export function createManualVeCandidate(
	dataset: VeEvaluationDataset,
	changes: readonly ManualVeChange[]
): ManualVeCandidate {
	verifyVeDataset(dataset);
	const original = dataset.tables.ve.values;
	const fractions = original.map((row) => row.map(() => 0));
	const values = original.map((row) => [...row]);
	const seen = new Set<string>();
	const percentages = new Map<string, number>();
	for (const change of changes) {
		const { rpmIndex: x, mapIndex: y, percent } = change;
		if (
			!Number.isSafeInteger(x) ||
			!Number.isSafeInteger(y) ||
			x < 0 ||
			y < 0 ||
			y >= original.length ||
			x >= original[y].length ||
			!Number.isFinite(percent)
		)
			throw new Error('Invalid manual VE correction.');
		const key = `${x},${y}`;
		if (seen.has(key)) throw new Error('Duplicate manual VE cell correction.');
		seen.add(key);
		if (Math.abs(percent) > dataset.config.maxCorrectionPct)
			throw new Error('Manual VE correction exceeds configured bound.');
		if (percent === 0) continue;
		const support = dataset.cells.find((c) => c.rpmIndex === x && c.mapIndex === y)!;
		if (support.status !== 'supported')
			throw new Error(`Unsupported VE cell ${key}: ${support.reasons.join(', ')}`);
		const value = original[y][x]! * (1 + percent / 100);
		if (!Number.isFinite(value) || value <= 0)
			throw new Error('Manual correction produces invalid VE.');
		fractions[y][x] = percent / 100;
		percentages.set(key, percent);
		values[y][x] = value;
	}
	const changedCells: VeCandidateContent['changedCells'] = [];
	for (let y = 0; y < values.length; y++)
		for (let x = 0; x < values[y].length; x++) {
			if (fractions[y][x] !== 0)
				changedCells.push({
					rpmIndex: x,
					mapIndex: y,
					percent: percentages.get(`${x},${y}`)!,
					originalVe: original[y][x]!,
					candidateVe: values[y][x]!
				});
		}
	const content: VeCandidateContent = {
		version: 'manual-ve-candidate-v1',
		datasetId: dataset.datasetId,
		correctionFractions: fractions,
		values,
		changedCells
	};
	return freezeVeArtifact({ ...content, candidateId: veContentHash(content) });
}

function metrics(errors: number[]): VeErrorMetrics {
	const statistics = afrErrorStatistics(errors);
	if (!errors.length) return { count: 0, mae: null, rmse: null, errors: statistics };
	const scale = Math.max(Math.abs(statistics.min!), Math.abs(statistics.max!)) || 1;
	const mae = errors.reduce((sum, e) => sum + Math.abs(e) / scale / errors.length, 0) * scale;
	const rmse =
		Math.sqrt(errors.reduce((sum, e) => sum + (e / scale) ** 2 / errors.length, 0)) * scale;
	return {
		count: errors.length,
		mae: Number.isFinite(mae) ? mae : null,
		rmse: Number.isFinite(rmse) ? rmse : null,
		errors: statistics
	};
}

function paired(rows: VePredictionRow[]): PairedVeMetrics {
	const failedPredictions = rows.filter((r) => r.status !== 'predicted').length;
	const baseline = metrics(rows.map((r) => r.baselineErrorAfr));
	const candidate = failedPredictions ? null : metrics(rows.map((r) => r.predictedErrorAfr!));
	return {
		status: failedPredictions ? 'prediction-failure' : rows.length ? 'complete' : 'empty',
		rowCount: rows.length,
		failedPredictions,
		baseline,
		candidate,
		predictedDeltaMae:
			baseline.mae !== null && candidate?.mae != null ? candidate.mae - baseline.mae : null,
		predictedDeltaRmse:
			baseline.rmse !== null && candidate?.rmse != null ? candidate.rmse - baseline.rmse : null
	};
}

/** Predictions only: AFR' = measured AFR * original interpolated VE / candidate
 * interpolated VE. Air mass and other fueling factors are assumed unchanged.
 */
export function evaluateVeCorrectionCandidate(
	dataset: VeEvaluationDataset,
	candidate: ManualVeCandidate,
	partition: 'training' | 'holdout' = 'holdout'
): VeCandidateEvaluation {
	verifyVeDataset(dataset);
	if (partition !== 'training' && partition !== 'holdout')
		throw new Error('Invalid VE evaluation partition.');
	const { candidateId, ...content } = candidate;
	if (candidate.datasetId !== dataset.datasetId || candidateId !== veContentHash(content))
		throw new Error('Candidate/dataset fingerprint mismatch.');
	// Revalidate serialized candidates, including unsupported cells and bounds.
	const rebuilt = createManualVeCandidate(dataset, candidate.changedCells);
	if (rebuilt.candidateId !== candidateId)
		throw new Error('Candidate vector and table are inconsistent.');
	const axes = dataset.tables.ve.provenance;
	const rows: VePredictionRow[] = dataset.rows
		.filter((row) => row.partition === partition && row.status === 'ready')
		.map((row) => {
			const afr = row.afr;
			const lookup = interpolateVe(
				axes.rpmAxis,
				axes.mapAxisKpa,
				candidate.values,
				afr.rpm!,
				afr.mapKpa!
			);
			const baselineAfr = afr.measuredAfr!,
				targetAfr = afr.target.value!,
				originalVe = row.ve.value!;
			const candidateVe = lookup.value;
			const predicted =
				candidateVe === null
					? NaN
					: candidateVe === originalVe
						? baselineAfr
						: baselineAfr * (originalVe / candidateVe);
			const error = predicted - targetAfr;
			const available =
				lookup.status === 'available' &&
				Number.isFinite(predicted) &&
				predicted > 0 &&
				Number.isFinite(error);
			const location = row.ve.location;
			if (location.status !== 'ok' || row.episodeId === null)
				throw new Error('Corrupt prepared VE row.');
			return {
				rowIndex: row.rowIndex,
				episodeId: row.episodeId,
				rpmIndex: location.neighborhood.rpmIndex,
				mapIndex: location.neighborhood.mapIndex,
				affected: row.ve.corners.some(
					(c) => c.bilinearWeight > 0 && candidate.correctionFractions[c.mapIndex][c.rpmIndex] !== 0
				),
				status: available ? 'predicted' : 'numerical-failure',
				baselineAfr,
				targetAfr,
				originalVe,
				candidateVe,
				predictedAfr: available ? predicted : null,
				baselineErrorAfr: afr.errorAfr!,
				predictedErrorAfr: available ? error : null
			};
		});
	const byEpisode = dataset.episodes
		.filter((e) => e.partition === partition)
		.map((e) => ({ episodeId: e.id, paired: paired(rows.filter((r) => r.episodeId === e.id)) }));
	const neighborhoodKeys = new Set(rows.map((r) => `${r.rpmIndex},${r.mapIndex}`));
	const byNeighborhood = [...neighborhoodKeys].map((key) => {
		const [rpmIndex, mapIndex] = key.split(',').map(Number);
		return {
			rpmIndex,
			mapIndex,
			paired: paired(rows.filter((r) => r.rpmIndex === rpmIndex && r.mapIndex === mapIndex))
		};
	});
	const changed = new Set<string>();
	for (const cell of candidate.changedCells)
		for (const x of [cell.rpmIndex - 1, cell.rpmIndex])
			for (const y of [cell.mapIndex - 1, cell.mapIndex]) {
				if (x >= 0 && y >= 0 && x < axes.rpmAxis.length - 1 && y < axes.mapAxisKpa.length - 1)
					changed.add(`${x},${y}`);
			}
	const changedNeighborhoods = [...changed]
		.sort((a, b) => {
			const [ax, ay] = a.split(',').map(Number),
				[bx, by] = b.split(',').map(Number);
			return ay - by || ax - bx;
		})
		.map((key) => {
			const [rpmIndex, mapIndex] = key.split(',').map(Number);
			const evaluationRows = rows.filter(
				(r) => r.rpmIndex === rpmIndex && r.mapIndex === mapIndex && r.affected
			).length;
			return {
				rpmIndex,
				mapIndex,
				evaluationRows,
				status: evaluationRows ? ('observed' as const) : ('unassessed' as const)
			};
		});
	return freezeVeArtifact({
		version: 've-model-prediction-v1',
		datasetId: dataset.datasetId,
		candidateId,
		partition,
		delay: { status: 'unimplemented-zero-placeholder', appliedMs: 0 },
		rows,
		paired: paired(rows),
		affectedOnly: paired(rows.filter((r) => r.affected)),
		byEpisode,
		byNeighborhood,
		changedNeighborhoods,
		limitations: [
			...dataset.limitations,
			'Candidate AFR and paired metric differences are model-based predictions, not measured improvements. The baseline is observed AFR with the original table unchanged.',
			'All ready rows in the declared evaluation partition are paired, including unchanged and worsened rows. Any failed prediction makes candidate aggregate metrics unavailable; failed rows are never silently dropped.',
			'Episode metric variation is descriptive uncertainty only. No calibrated confidence interval, identifiability assessment, optimizer or automatic correction selection is implemented.',
			'Repeated manual changes after viewing holdout results turn the holdout into development data; reserve a new untouched holdout for final evaluation.'
		]
	});
}
