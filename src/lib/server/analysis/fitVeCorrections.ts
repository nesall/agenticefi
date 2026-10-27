import type { VeEvaluationDataset } from '../../shared/types/veEvaluation';
import type {
	FitCellDiagnostic,
	FitPassDiagnostic,
	VeFitConfig,
	VeFitResult,
	VeFittedEvaluation
} from '../../shared/types/veFitting';
import { createManualVeCandidate, evaluateVeCorrectionCandidate } from './predictVeCandidate';
import { freezeVeArtifact, veContentHash, verifyVeDataset } from './veArtifacts';
import { influenceConditioning, solveBoundedVe, type FitObservation } from './veFitMath';

/** Initial numerical policy. No automatic tuning of these values or Phase A gates. */
export const DEFAULT_VE_FIT_CONFIG: Readonly<VeFitConfig> = Object.freeze({
	maxCorrectionPct: 3,
	huberThreshold: 0.02,
	ridgePenalty: 0.01,
	maxConditionNumber: 1000,
	relativeRankTolerance: 1e-6,
	minCorrectionPct: 0.5,
	maxLooRangePct: 2,
	minLooRemainingEpisodes: 2,
	maxIterations: 5000,
	gradientTolerance: 1e-10
});

export function veFitConfig(overrides: Partial<VeFitConfig> = {}): VeFitConfig {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
		throw new Error('VE fitting config must be an object.');
	for (const [key, value] of Object.entries(overrides))
		if (
			!Object.hasOwn(DEFAULT_VE_FIT_CONFIG, key) ||
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value < 0
		)
			throw new Error(`Invalid VE fitting option: ${key}`);
	const config = { ...DEFAULT_VE_FIT_CONFIG, ...overrides };
	if (
		config.maxCorrectionPct >= 100 ||
		config.huberThreshold <= 0 ||
		config.maxConditionNumber < 1 ||
		config.relativeRankTolerance <= 0 ||
		config.relativeRankTolerance >= 1 ||
		config.gradientTolerance <= 0 ||
		![config.minLooRemainingEpisodes, config.maxIterations].every(
			(v) => Number.isSafeInteger(v) && v >= 1
		)
	)
		throw new Error('Invalid VE fitting thresholds.');
	return config;
}

/** Only training observations and training support enter numerical fitting and
 * selection. Dataset identity validation reads the artifact but no holdout error
 * is used. The evaluation wrapper runs only after this immutable result exists.
 */
export function fitVeCorrections(
	dataset: VeEvaluationDataset,
	overrides: Partial<VeFitConfig> = {}
): VeFitResult {
	verifyVeDataset(dataset);
	const config = veFitConfig(overrides);
	const effectiveMaxPct = Math.min(config.maxCorrectionPct, dataset.config.maxCorrectionPct),
		bound = effectiveMaxPct / 100;
	const columns = dataset.tables.ve.provenance.rpmAxis.length;
	const training = dataset.rows.filter(
		(row) => row.partition === 'training' && row.status === 'ready'
	);
	const rows: FitObservation[] = training.map((row) => ({
		rowIndex: row.rowIndex,
		episodeId: row.episodeId!,
		b: row.afr.measuredAfr! / row.afr.target.value! - 1,
		terms: row.ve.corners
			.filter((c) => c.relativeInfluence !== null && c.relativeInfluence > 0)
			.map((c) => ({ cellIndex: c.mapIndex * columns + c.rpmIndex, a: c.relativeInfluence! }))
	}));
	const episodeIds = [...new Set(rows.map((r) => r.episodeId))].sort((a, b) => a - b);
	const invalidTrainingRowIndices = rows
		.filter(
			(r) =>
				!Number.isFinite(r.b) ||
				r.terms.some((t) => !Number.isFinite(t.a) || t.a < 0) ||
				Math.abs(r.terms.reduce((sum, t) => sum + t.a, 0) - 1) > 1e-9
		)
		.map((r) => r.rowIndex);
	const cells: FitCellDiagnostic[] = dataset.cells.map((cell, cellIndex) => ({
		cellIndex,
		rpmIndex: cell.rpmIndex,
		mapIndex: cell.mapIndex,
		status: cell.status === 'supported' ? 'suppressed' : 'unsupported',
		reasons: cell.status === 'supported' ? [] : [...cell.reasons],
		materialTrainingSamples: cell.materialTrainingSamples,
		qualifyingEpisodeIds: [...cell.qualifyingEpisodeIds],
		trainingInfluenceMass: cell.trainingInfluenceMass,
		finalCorrectionPct: 0,
		lastProposedPct: null,
		lastProposalPass: null,
		atBound: false,
		stability: null
	}));
	let active = dataset.cells.flatMap((cell, i) => (cell.status === 'supported' ? [i] : []));
	const passes: FitPassDiagnostic[] = [];
	const percent = (fraction: number) =>
		fraction === bound ? effectiveMaxPct : fraction === -bound ? -effectiveMaxPct : fraction * 100;
	while (active.length) {
		const pass: (typeof passes)[number] = {
			pass: passes.length + 1,
			activeCellIndices: [...active],
			conditioning: [],
			solver: null,
			folds: [],
			frozen: []
		};
		passes.push(pass);
		const frozen = new Map<number, string[]>();
		const suppress = (indices: readonly number[], reason: string) => {
			for (const i of indices) {
				if (!frozen.has(i)) frozen.set(i, []);
				if (!frozen.get(i)!.includes(reason)) frozen.get(i)!.push(reason);
			}
		};
		const commit = () => {
			for (const [cellIndex, reasons] of frozen) {
				cells[cellIndex].status = 'suppressed';
				cells[cellIndex].reasons.push(...reasons);
				pass.frozen.push({ cellIndex, reasons });
			}
			active = active.filter((i) => !frozen.has(i));
		};
		if (invalidTrainingRowIndices.length) {
			suppress(active, 'INVALID_TRAINING_NUMERICS');
			commit();
			continue;
		}
		pass.conditioning = influenceConditioning(rows, active, config);
		for (const group of pass.conditioning)
			if (group.status !== 'identifiable')
				suppress(group.cellIndices, `GROUP_${group.status.toUpperCase().replaceAll('-', '_')}`);
		if (frozen.size) {
			commit();
			continue;
		}
		const solution = solveBoundedVe(rows, active, bound, config);
		pass.solver = solution.diagnostic;
		if (solution.diagnostic.status !== 'converged') {
			suppress(active, `SOLVER_${solution.diagnostic.status.toUpperCase().replaceAll('-', '_')}`);
			commit();
			continue;
		}
		const proposals = new Map(active.map((cell, i) => [cell, percent(solution.values[i])]));
		for (const i of active) {
			const value = proposals.get(i)!;
			cells[i].lastProposedPct = value;
			cells[i].lastProposalPass = pass.pass;
			cells[i].stability = null;
			cells[i].atBound = Math.abs(value) === effectiveMaxPct;
			if (!Number.isFinite(value) || Math.abs(value) > effectiveMaxPct)
				suppress([i], 'INVALID_SOLVER_BOUND');
			else if (value === 0 || Math.abs(value) < config.minCorrectionPct)
				suppress([i], 'BELOW_MINIMUM_PROPOSAL');
		}
		if (frozen.size) {
			commit();
			continue;
		}
		const foldValues = new Map(
			active.map((i) => [i, [] as { omittedEpisodeId: number; percent: number | null }[]])
		);
		for (const omitted of episodeIds) {
			const foldRows = rows.filter((r) => r.episodeId !== omitted);
			const insufficient = active.filter(
				(i) =>
					cells[i].qualifyingEpisodeIds.filter((id) => id !== omitted).length <
					config.minLooRemainingEpisodes
			);
			if (insufficient.length) {
				suppress(insufficient, 'LOO_INSUFFICIENT_EPISODES');
				pass.folds.push({
					omittedEpisodeId: omitted,
					status: 'insufficient-episodes',
					conditioning: [],
					solver: null
				});
				for (const i of active)
					foldValues.get(i)!.push({ omittedEpisodeId: omitted, percent: null });
				break;
			}
			const conditioning = influenceConditioning(foldRows, active, config);
			for (const group of conditioning)
				if (group.status !== 'identifiable')
					suppress(
						group.cellIndices,
						`LOO_GROUP_${group.status.toUpperCase().replaceAll('-', '_')}`
					);
			if (frozen.size) {
				pass.folds.push({
					omittedEpisodeId: omitted,
					status: 'conditioning-failure',
					conditioning,
					solver: null
				});
				for (const i of active)
					foldValues.get(i)!.push({ omittedEpisodeId: omitted, percent: null });
				break;
			}
			const fold = solveBoundedVe(foldRows, active, bound, config);
			const converged = fold.diagnostic.status === 'converged';
			pass.folds.push({
				omittedEpisodeId: omitted,
				status: converged ? 'converged' : 'solver-failure',
				conditioning,
				solver: fold.diagnostic
			});
			for (const [position, i] of active.entries())
				foldValues.get(i)!.push({
					omittedEpisodeId: omitted,
					percent: converged ? percent(fold.values[position]) : null
				});
			if (!converged) {
				suppress(active, 'LOO_SOLVER_FAILURE');
				break;
			}
		}
		for (const i of active) {
			const folds = foldValues.get(i)!;
			const values = folds.flatMap((f) => (f.percent === null ? [] : [f.percent]));
			const complete = folds.length === episodeIds.length && values.length === episodeIds.length;
			const minimum = complete ? Math.min(...values) : null,
				maximum = complete ? Math.max(...values) : null;
			const directionStable = complete
				? values.every((v) => v !== 0 && Math.sign(v) === Math.sign(proposals.get(i)!))
				: null;
			cells[i].stability = {
				foldPercentages: folds,
				minPct: minimum,
				maxPct: maximum,
				rangePct: minimum === null || maximum === null ? null : maximum - minimum,
				directionStable
			};
			if (complete && directionStable === false) suppress([i], 'LOO_DIRECTION_UNSTABLE');
			if (complete && maximum! - minimum! > config.maxLooRangePct)
				suppress([i], 'LOO_EXCESSIVE_RANGE');
		}
		if (frozen.size) {
			commit();
			continue;
		}
		for (const i of active) {
			cells[i].status = 'accepted';
			cells[i].finalCorrectionPct = proposals.get(i)!;
		}
		break;
	}
	const accepted = cells.filter((c) => c.status === 'accepted');
	const candidate = createManualVeCandidate(
		dataset,
		accepted.map((c) => ({
			rpmIndex: c.rpmIndex,
			mapIndex: c.mapIndex,
			percent: c.finalCorrectionPct
		}))
	);
	return freezeVeArtifact({
		version: 've-joint-fit-v1',
		datasetId: dataset.datasetId,
		trainingFingerprint: veContentHash({
			rows,
			cells: dataset.cells,
			table: dataset.tables.ve,
			target: dataset.tables.targetAfr,
			preparationConfig: dataset.config,
			fitConfig: config
		}),
		config,
		bounds: {
			requestedMaxPct: config.maxCorrectionPct,
			datasetMaxPct: dataset.config.maxCorrectionPct,
			effectiveMaxPct
		},
		trainingRows: rows.length,
		trainingEpisodeIds: episodeIds,
		invalidTrainingRowIndices,
		status: candidate.changedCells.length ? 'candidate' : 'no-supported-proposal',
		cells,
		passes,
		candidate,
		limitations: [
			...dataset.limitations.map((limitation) =>
				limitation.startsWith('Phase A cell support')
					? 'Phase A support measures training coverage; Phase B adds numerical conditioning and stability checks, not measured correction accuracy.'
					: limitation
			),
			'Phase B candidates are fitted from ready training rows only; holdout outcomes are not used in fitting, suppression, thresholds or model selection.',
			'Conditioning uses episode-weighted, column-normalized unregularized influence matrices. Entire unidentifiable connected groups are suppressed; ridge does not establish identifiability.',
			'Leave-one-training-episode-out ranges are stability diagnostics, not calibrated confidence intervals; episodes may remain correlated.',
			'Huber loss fits relative fueling residuals rather than directly minimizing holdout AFR error. Phase A prediction assumptions and zero/unimplemented AFR delay remain unchanged.',
			'Bounds are imposed inside the solver. Suppressed cells remain frozen at zero, with full refitting and repeated conditioning/stability checks; no completed vector is silently clipped.'
		]
	});
}

/** Explicit one-way sequencing: finalize fitting before exposing holdout metrics. */
export function fitAndEvaluateVeCorrections(
	dataset: VeEvaluationDataset,
	overrides: Partial<VeFitConfig> = {}
): VeFittedEvaluation {
	const fit = fitVeCorrections(dataset, overrides);
	return freezeVeArtifact({
		fit,
		evaluation: evaluateVeCorrectionCandidate(dataset, fit.candidate)
	});
}
