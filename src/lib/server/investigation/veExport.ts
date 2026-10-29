import type { VeEvaluationDataset, Immutable } from '../../shared/types/veEvaluation';
import type { VeFitResult } from '../../shared/types/veFitting';
import { freezeVeArtifact, veContentHash, verifyVeDataset } from '../analysis/veArtifacts';

type Table = {
	xBreakpoints: readonly number[];
	yBreakpoints: readonly number[];
	values: readonly (readonly (number | null)[])[];
};
export type VeExportSnapshot = Immutable<{
	calibrationId: string;
	datasetId: string;
	candidateId: string;
	profile: string;
	originalSha256: string;
	candidateSha256: string;
	rpm: number[];
	mapKpa: number[];
	values: number[][];
	corrections: {
		accepted: number;
		changed: number;
		suppressed: number;
		unsupported: number;
		atBound: number;
		maxAbsPct: number;
	};
}>;

/** All validation precedes publication. Copies finalized values; never fits or repairs a candidate. */
export function createVeExportSnapshot(input: {
	calibrationId: string;
	profile: string;
	original: Table;
	dataset: VeEvaluationDataset;
	fit: VeFitResult;
	fitSha256: string;
	candidateSha256: string;
}): VeExportSnapshot {
	const { original, dataset, fit } = input;
	verifyVeDataset(dataset);
	const candidate = fit.candidate;
	const { candidateId, ...content } = candidate;
	if (
		fit.datasetId !== dataset.datasetId ||
		candidate.datasetId !== dataset.datasetId ||
		candidateId !== veContentHash(content) ||
		input.candidateSha256 !== veContentHash(candidate) ||
		input.fitSha256 !== veContentHash(fit)
	)
		throw new Error('Export artifact fingerprint mismatch.');
	const axis = (a: readonly number[]) =>
		a.length === 16 && a.every((v, i) => Number.isFinite(v) && (i === 0 || v > a[i - 1]));
	const matrix = (a: readonly (readonly (number | null)[])[]) =>
		a.length === 16 &&
		a.every(
			(row) => row.length === 16 && row.every((v) => typeof v === 'number' && Number.isFinite(v))
		);
	if (
		!axis(original.xBreakpoints) ||
		!axis(original.yBreakpoints) ||
		!matrix(original.values) ||
		!matrix(candidate.values) ||
		!matrix(candidate.correctionFractions)
	)
		throw new Error('Export requires complete finite 16 by 16 calibration data.');
	const imported = {
		xBreakpoints: dataset.tables.ve.provenance.rpmAxis,
		yBreakpoints: dataset.tables.ve.provenance.mapAxisKpa,
		values: dataset.tables.ve.values
	};
	if (veContentHash(original) !== veContentHash(imported))
		throw new Error('Export calibration fingerprint mismatch.');
	const keys = new Set<string>();
	if (fit.cells.length !== 256) throw new Error('Export requires every finalized cell decision.');
	for (const cell of fit.cells) {
		const x = cell.rpmIndex,
			y = cell.mapIndex,
			key = `${x}:${y}`;
		if (
			!Number.isInteger(x) ||
			!Number.isInteger(y) ||
			x < 0 ||
			x >= 16 ||
			y < 0 ||
			y >= 16 ||
			keys.has(key)
		)
			throw new Error('Invalid export cell coordinates.');
		keys.add(key);
		const fraction = candidate.correctionFractions[y][x];
		if (
			!Number.isFinite(cell.finalCorrectionPct) ||
			fraction !== cell.finalCorrectionPct / 100 ||
			Math.abs(cell.finalCorrectionPct) > fit.bounds.effectiveMaxPct ||
			(cell.status !== 'accepted' && fraction !== 0) ||
			candidate.values[y][x] !== original.values[y][x]! * (1 + fraction)
		)
			throw new Error('Export candidate disagrees with finalized decisions.');
	}
	const snapshot = {
		calibrationId: input.calibrationId,
		datasetId: dataset.datasetId,
		candidateId,
		profile: input.profile,
		originalSha256: veContentHash(original),
		candidateSha256: input.candidateSha256,
		rpm: [...original.xBreakpoints],
		mapKpa: [...original.yBreakpoints],
		values: candidate.values.map((row) => row.map((v) => v!)),
		corrections: {
			accepted: fit.cells.filter((c) => c.status === 'accepted').length,
			changed: fit.cells.filter((c) => c.status === 'accepted' && c.finalCorrectionPct !== 0)
				.length,
			suppressed: fit.cells.filter((c) => c.status === 'suppressed').length,
			unsupported: fit.cells.filter((c) => c.status === 'unsupported').length,
			atBound: fit.cells.filter((c) => c.status === 'accepted' && c.atBound).length,
			maxAbsPct: Math.max(...fit.cells.map((c) => Math.abs(c.finalCorrectionPct)))
		}
	};
	if (Buffer.byteLength(JSON.stringify(snapshot)) > 65536)
		throw new Error('Export snapshot byte budget exceeded.');
	return freezeVeArtifact(snapshot);
}

export function veExportCsv(snapshot: VeExportSnapshot): string {
	return (
		[
			['MAP_kPa / RPM', ...snapshot.rpm].join(','),
			...snapshot.values.map((row, i) => [snapshot.mapKpa[i], ...row].map(String).join(','))
		].join('\r\n') + '\r\n'
	);
}

export function veExportProvenance(
	snapshot: VeExportSnapshot,
	partial: boolean,
	evaluated: boolean,
	pairedStatus?: string
) {
	return {
		version: 'advisory-ve-csv-v1',
		advisoryOnly: true,
		directlyImportableCalibration: false,
		calibrationId: snapshot.calibrationId,
		datasetId: snapshot.datasetId,
		candidateId: snapshot.candidateId,
		profile: snapshot.profile,
		originalSha256: snapshot.originalSha256,
		candidateSha256: snapshot.candidateSha256,
		corrections: snapshot.corrections,
		investigation: partial ? 'partial' : 'completed',
		evaluation: evaluated ? 'held-out conditional model predictions available' : 'unavailable',
		pairedStatus: pairedStatus ?? 'unavailable',
		assumptions: [
			'Proportional fueling model; AFR sensor delay is unimplemented at 0 ms.',
			'Candidate fitting uses training data only; holdout does not select corrections.'
		],
		limitations: [
			'Advisory data export; not a directly importable ECU or TunerStudio calibration.',
			'Not engine validated. Predictions are not measured improvements. No ECU writes.',
			...(partial ? ['Investigation incomplete; candidate finalized before interruption.'] : []),
			...(!evaluated ? ['Held-out evaluation unavailable.'] : [])
		]
	};
}
