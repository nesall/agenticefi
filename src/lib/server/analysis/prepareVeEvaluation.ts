import type { LogSession } from '../core/LogSession';
import type { CategoricalEvidence } from '../msl/parseMslWithEligibilityEvidence';
import type { EligibilityConfig } from '../../shared/types/sampleEligibility';
import type { ExperimentalEligibilityConfig } from '../../shared/types/sampleEligibilityV2';
import type {
	VeCellSupport,
	VeDatasetContent,
	VeEpisode,
	VeEvaluationDataset,
	VeEvaluationRow,
	VePreparationConfig
} from '../../shared/types/veEvaluation';
import { analyzeTargetAfrError, type AnalysisCalibration } from './targetAfrError';
import { classifySampleEligibility } from './sampleEligibility';
import { classifyExperimentalEligibility } from './sampleEligibilityV2';
import { interpolateVe } from './veInterpolation';
import { freezeVeArtifact, veContentHash } from './veArtifacts';

export const DEFAULT_VE_PREPARATION_CONFIG: Readonly<VePreparationConfig> = Object.freeze({
	trainingFraction: 0.7,
	episodeMergeGapSec: 10,
	embargoSec: 10,
	maxObservationGapSec: 0.5,
	maxCorrectionPct: 3,
	minTrainingSamplesPerCell: 50,
	minTrainingEpisodesPerCell: 3,
	minEpisodeSupportSec: 2,
	minRelativeInfluence: 0.1
});
export type VeEligibilityProfile =
	| { version: 'steady-afr-ve-v1'; config?: Partial<EligibilityConfig> }
	| {
			version: 'steady-afr-ve-v2-experimental';
			config?: Partial<ExperimentalEligibilityConfig>;
			baseConfig?: Partial<EligibilityConfig>;
	  };

function configuration(overrides: Partial<VePreparationConfig> = {}): VePreparationConfig {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
		throw new Error('VE preparation config must be an object.');
	for (const [key, value] of Object.entries(overrides)) {
		if (
			!Object.hasOwn(DEFAULT_VE_PREPARATION_CONFIG, key) ||
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value < 0
		)
			throw new Error(`Invalid VE preparation option: ${key}`);
	}
	const config = { ...DEFAULT_VE_PREPARATION_CONFIG, ...overrides };
	if (
		config.trainingFraction <= 0 ||
		config.trainingFraction >= 1 ||
		config.maxCorrectionPct >= 100 ||
		config.maxObservationGapSec <= 0 ||
		config.minRelativeInfluence <= 0 ||
		config.minRelativeInfluence > 1 ||
		![config.minTrainingEpisodesPerCell, config.minTrainingSamplesPerCell].every(
			(v) => Number.isSafeInteger(v) && v >= 1
		)
	)
		throw new Error('Invalid VE evidence or partition thresholds.');
	return config;
}

/** Group complete accepted runs, merging nearby runs irrespective of AFR error or
 * neighborhood. Invalid/reversed time, gaps and stitches always break episodes.
 */
function episodesFor(
	session: LogSession,
	samples: { timeSec: number | null; status: string }[],
	config: VePreparationConfig
): VeEpisode[] {
	const stitches = new Set(
		session.discontinuities.filter((d) => d.cause === 'StitchPoint').map((d) => d.rowIndex)
	);
	const episodes: VeEpisode[] = [];
	let segment = 0,
		highWater = -Infinity;
	for (let row = 0; row < samples.length; row++) {
		const t = samples[row].timeSec,
			previous = samples[row - 1]?.timeSec;
		const ordered = t !== null && t > highWater;
		if (t !== null) highWater = Math.max(highWater, t);
		if (!ordered) {
			segment++;
			continue;
		}
		if (
			row > 0 &&
			(previous == null || t! - previous > config.maxObservationGapSec || stitches.has(row))
		)
			segment++;
		if (samples[row].status !== 'eligible') continue;
		const last = episodes.at(-1);
		const adjacent =
			last && last.endRow === row - 1 && t! - last.endTimeSec <= config.maxObservationGapSec;
		if (
			last &&
			last.segmentId === segment &&
			(adjacent || t! - last.endTimeSec < config.episodeMergeGapSec)
		) {
			last.endRow = row;
			last.endTimeSec = t!;
			last.initialEligibleCount++;
		} else
			episodes.push({
				id: episodes.length,
				segmentId: segment,
				startRow: row,
				endRow: row,
				startTimeSec: t!,
				endTimeSec: t!,
				initialEligibleCount: 1,
				partition: 'unassigned'
			});
	}
	return episodes;
}

function splitEpisodes(
	episodes: VeEpisode[],
	config: VePreparationConfig
): VeDatasetContent['split'] {
	const unavailable: VeDatasetContent['split'] = {
		status: 'insufficient-separated-episodes',
		training: null,
		holdout: null,
		actualGapSec: null
	};
	if (episodes.length < 2) return unavailable;
	const span = episodes.at(-1)!.endTimeSec - episodes[0].startTimeSec;
	if (!Number.isFinite(span)) return unavailable;
	const target = episodes[0].startTimeSec + config.trainingFraction * span;
	let best: { trainingEnd: number; holdoutStart: number; distance: number } | null = null;
	for (let i = 0; i < episodes.length - 1; i++) {
		let j = i + 1;
		while (
			j < episodes.length &&
			episodes[j].startTimeSec - episodes[i].endTimeSec < config.embargoSec
		)
			j++;
		if (j === episodes.length) continue;
		const midpoint =
			episodes[i].endTimeSec + (episodes[j].startTimeSec - episodes[i].endTimeSec) / 2;
		const distance = Math.abs(midpoint - target);
		if (!best || distance < best.distance) best = { trainingEnd: i, holdoutStart: j, distance };
	}
	if (!best) return unavailable;
	for (const [i, episode] of episodes.entries())
		episode.partition =
			i <= best.trainingEnd ? 'training' : i >= best.holdoutStart ? 'holdout' : 'embargo';
	return {
		status: 'ready',
		training: {
			startRow: episodes[0].startRow,
			endRowExclusive: episodes[best.trainingEnd].endRow + 1
		},
		holdout: {
			startRow: episodes[best.holdoutStart].startRow,
			endRowExclusive: episodes.at(-1)!.endRow + 1
		},
		actualGapSec: episodes[best.holdoutStart].startTimeSec - episodes[best.trainingEnd].endTimeSec
	};
}

function cellEvidence(
	rows: VeEvaluationRow[],
	table: VeDatasetContent['tables']['ve'],
	config: VePreparationConfig
): VeCellSupport[] {
	const cells: VeCellSupport[] = [];
	const evidence = new Map<
		string,
		Map<
			number,
			{
				samples: number;
				lastRow: number;
				lastTime: number;
				currentSec: number;
				longestContinuousSec: number;
			}
		>
	>();
	const mass = new Map<string, number>();
	for (const row of rows) {
		if (row.partition !== 'training' || row.status !== 'ready') continue;
		for (const corner of row.ve.corners) {
			const a = corner.relativeInfluence!;
			if (!(a > 0)) continue;
			const key = `${corner.rpmIndex},${corner.mapIndex}`;
			mass.set(key, (mass.get(key) ?? 0) + a);
			if (a < config.minRelativeInfluence) continue;
			if (!evidence.has(key)) evidence.set(key, new Map());
			const episodes = evidence.get(key)!;
			const episodeId = row.episodeId!;
			let episode = episodes.get(episodeId);
			const time = row.afr.timeSec!;
			if (!episode) {
				episode = {
					samples: 0,
					lastRow: -2,
					lastTime: time,
					currentSec: 0,
					longestContinuousSec: 0
				};
				episodes.set(episodeId, episode);
			}
			const dt = time - episode.lastTime;
			episode.currentSec =
				row.rowIndex === episode.lastRow + 1 && dt > 0 && dt <= config.maxObservationGapSec
					? episode.currentSec + dt
					: 0;
			episode.longestContinuousSec = Math.max(episode.longestContinuousSec, episode.currentSec);
			episode.samples++;
			episode.lastRow = row.rowIndex;
			episode.lastTime = time;
		}
	}
	for (let y = 0; y < table.values.length; y++)
		for (let x = 0; x < table.values[y].length; x++) {
			const key = `${x},${y}`,
				originalVe = table.values[y][x];
			const episodeEvidence = [...(evidence.get(key)?.entries() ?? [])].map(([episodeId, e]) => ({
				episodeId,
				samples: e.samples,
				longestContinuousSec: e.longestContinuousSec
			}));
			const qualifyingEpisodeIds = episodeEvidence
				.filter((e) => e.longestContinuousSec >= config.minEpisodeSupportSec)
				.map((e) => e.episodeId);
			const materialTrainingSamples = episodeEvidence.reduce((sum, e) => sum + e.samples, 0);
			const reasons: string[] = [];
			if (originalVe === null || !Number.isFinite(originalVe) || originalVe <= 0)
				reasons.push('INVALID_ORIGINAL_VE');
			if (materialTrainingSamples < config.minTrainingSamplesPerCell)
				reasons.push('INSUFFICIENT_TRAINING_SAMPLES');
			if (qualifyingEpisodeIds.length < config.minTrainingEpisodesPerCell)
				reasons.push('INSUFFICIENT_TRAINING_EPISODES');
			cells.push({
				rpmIndex: x,
				mapIndex: y,
				originalVe,
				status: reasons.length ? 'unsupported' : 'supported',
				reasons,
				materialTrainingSamples,
				trainingInfluenceMass: mass.get(key) ?? 0,
				qualifyingEpisodeIds,
				episodeEvidence
			});
		}
	return cells;
}

/** Phase A prepares fresh eligibility and immutable content-bound observations;
 * no fitting, optimization, or input table/session mutation occurs here.
 */
export function prepareVeEvaluationDataset(input: {
	session: LogSession;
	targetAfrTable: AnalysisCalibration<'AFR'>;
	veTable: AnalysisCalibration<'VE'>;
	eligibilityProfile: VeEligibilityProfile;
	categorical?: CategoricalEvidence;
	config?: Partial<VePreparationConfig>;
}): VeEvaluationDataset {
	const { session, eligibilityProfile: profile } = input;
	const config = configuration(input.config);
	if (
		input.categorical &&
		(input.categorical.session !== session ||
			input.categorical.fuelCut.length !== session.rowCount ||
			input.categorical.overrunFuelCut.length !== session.rowCount)
	)
		throw new Error('Categorical evidence does not belong to the prepared session.');
	if (!['steady-afr-ve-v1', 'steady-afr-ve-v2-experimental'].includes(profile.version))
		throw new Error('Unsupported eligibility profile.');
	const full =
		profile.version === 'steady-afr-ve-v1'
			? classifySampleEligibility(session, profile.config)
			: classifyExperimentalEligibility(session, {
					config: profile.config,
					baseConfig: profile.baseConfig,
					categorical: input.categorical
				});
	const analysis = analyzeTargetAfrError({ ...input, eligibility: full });
	const episodes = episodesFor(session, full.samples, config);
	const split = splitEpisodes(episodes, config);
	const tables: VeDatasetContent['tables'] = {
		targetAfr: {
			provenance: analysis.tables.targetAfr,
			values: input.targetAfrTable.table.toJSON().values
		},
		ve: { provenance: analysis.tables.ve, values: input.veTable.table.toJSON().values }
	};
	const afrRows = [...analysis.samples];
	const support = new Map<number, { startRow: number; endRow: number }>();
	for (const partition of [split.training, split.holdout]) {
		if (!partition) continue;
		if (profile.version === 'steady-afr-ve-v2-experimental') {
			const local = classifyExperimentalEligibility(session, {
				config: profile.config,
				baseConfig: profile.baseConfig,
				categorical: input.categorical,
				partition
			});
			const localAnalysis = analyzeTargetAfrError({ ...input, eligibility: local });
			for (const row of localAnalysis.samples) afrRows[row.rowIndex] = row;
			for (const row of local.samples)
				if (
					row.window?.startRow !== null &&
					row.window?.startRow !== undefined &&
					row.window.endRow !== null
				)
					support.set(row.rowIndex, {
						startRow: Math.max(0, row.window.startRow - 1),
						endRow: row.window.endRow
					});
		}
	}
	const episodeByRow = new Map<number, VeEpisode>();
	for (const episode of episodes)
		for (let row = episode.startRow; row <= episode.endRow; row++) episodeByRow.set(row, episode);
	const veAxes = tables.ve.provenance;
	const rows: VeEvaluationRow[] = afrRows.map((afr) => {
		const row = afr.rowIndex,
			episode = episodeByRow.get(row);
		const partition =
			split.training && row >= split.training.startRow && row < split.training.endRowExclusive
				? 'training'
				: split.holdout && row >= split.holdout.startRow && row < split.holdout.endRowExclusive
					? 'holdout'
					: split.training &&
						  split.holdout &&
						  row >= split.training.endRowExclusive &&
						  row < split.holdout.startRow
						? 'embargo'
						: 'unassigned';
		const range =
			partition === 'training' ? split.training : partition === 'holdout' ? split.holdout : null;
		const ve = interpolateVe(
			veAxes.rpmAxis,
			veAxes.mapAxisKpa,
			tables.ve.values,
			afr.rpm ?? NaN,
			afr.mapKpa ?? NaN
		);
		const reasons: string[] = [];
		if (!range)
			reasons.push(
				split.status === 'ready'
					? 'OUTSIDE_EVALUATION_PARTITIONS'
					: 'INSUFFICIENT_SEPARATED_EPISODES'
			);
		if (!episode) reasons.push('NO_EPISODE');
		if (afr.eligibilityStatus !== 'eligible') reasons.push('CLASSIFIER_NOT_ELIGIBLE');
		if (afr.errorStatus !== 'available') reasons.push('AFR_OBSERVATION_UNAVAILABLE');
		if (ve.status !== 'available')
			reasons.push(`VE_${ve.status.toUpperCase().replaceAll('-', '_')}`);
		let supportRows = support.get(row) ?? null;
		if (range && profile.version === 'steady-afr-ve-v1') {
			const steady =
				full.classifierVersion === 'steady-afr-ve-v1' ? full.config.steadyWindowSec : 0;
			const startTime = analysis.samples[range.startRow].timeSec;
			// Audit causal V1 support without altering its outputs: require an internal
			// predecessor and a full configured dwell elapsed inside this partition.
			if (
				row <= range.startRow ||
				startTime === null ||
				afr.timeSec === null ||
				afr.timeSec - startTime < steady
			)
				reasons.push('PARTITION_SUPPORT_LEAKAGE');
			else {
				let first = row - 1;
				while (first > range.startRow && analysis.samples[first].timeSec! > afr.timeSec! - steady)
					first--;
				supportRows = { startRow: first, endRow: row };
			}
		}
		if (
			range &&
			profile.version === 'steady-afr-ve-v2-experimental' &&
			(!supportRows ||
				supportRows.startRow < range.startRow ||
				supportRows.endRow >= range.endRowExclusive)
		)
			reasons.push('PARTITION_SUPPORT_LEAKAGE');
		return {
			rowIndex: row,
			episodeId: episode?.id ?? null,
			partition,
			status: reasons.length ? 'excluded' : 'ready',
			reasons,
			afr,
			ve,
			supportRows
		};
	});
	const cells = cellEvidence(rows, tables.ve, config);
	const exclusionCounts: Record<string, number> = {};
	for (const row of rows)
		for (const reason of row.reasons) exclusionCounts[reason] = (exclusionCounts[reason] ?? 0) + 1;
	const content: VeDatasetContent = {
		version: 've-evaluation-phase-a-v1',
		config,
		resolutions: analysis.resolutions,
		manifest: {
			sessionSha256: veContentHash({
				channels: session.channels.map((c) => ({
					name: c.name,
					unit: c.unit,
					values: c.values,
					isBoolean: c.isBoolean,
					isTimestamp: c.isTimestamp
				})),
				mapping: session.channelMapping.toJSON(),
				rowCount: session.rowCount,
				timeChannelIndex: session.timeChannelIndex,
				discontinuities: session.discontinuities,
				categorical: input.categorical
					? { fuelCut: input.categorical.fuelCut, overrunFuelCut: input.categorical.overrunFuelCut }
					: null
			}),
			targetTableSha256: veContentHash(tables.targetAfr),
			veTableSha256: veContentHash(tables.ve),
			classifierVersion: full.classifierVersion,
			classifierConfig: { ...full.config },
			baseClassifierConfig:
				full.classifierVersion === 'steady-afr-ve-v2-experimental' ? { ...full.baseConfig } : null
		},
		tables,
		split,
		episodes,
		rows,
		cells,
		coverage: {
			trainingRows: rows.filter((r) => r.partition === 'training' && r.status === 'ready').length,
			holdoutRows: rows.filter((r) => r.partition === 'holdout' && r.status === 'ready').length,
			supportedCells: cells.filter((c) => c.status === 'supported').length,
			totalCells: cells.length,
			exclusionCounts
		},
		limitations: [
			...analysis.limitations,
			'Phase A cell support measures training coverage only, not identifiability, correction accuracy, or confidence. No corrections are fitted.',
			'Episodes group whole accepted runs without AFR-error selection; nearby runs may remain correlated. Temporal gaps and embargo do not establish independence.',
			'Partitioning uses fixed full-log eligibility to define episodes, then audits V1 boundaries or recomputes V2 within each partition. Full-log time high-water integrity is retained.',
			'Calibration association and active ECU table/fueling mode require caller confirmation. Source content hashes detect mismatched artifacts, not incorrect calibration association.',
			'Fuel is assumed proportional to interpolated VE with other factors fixed. Closed-loop corrections, injector behavior, sensor bias and unimplemented AFR delay can invalidate predictions.',
			'Effects in unobserved neighboring operating regions are unassessed. V1 categorical fuel-cut limitations remain unchanged.'
		]
	};
	return freezeVeArtifact({ ...content, datasetId: veContentHash(content) });
}
