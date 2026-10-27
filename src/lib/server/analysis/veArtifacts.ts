import { createHash } from 'node:crypto';
import type { Immutable, VeEvaluationDataset } from '../../shared/types/veEvaluation';

/** Content identity, including distinct nonfinite telemetry values. Not an authenticity signature. */
export function veContentHash(value: unknown): string {
	return createHash('sha256')
		.update(
			JSON.stringify(value, (_key, v: unknown) =>
				typeof v === 'number' && !Number.isFinite(v) ? { nonfiniteNumber: String(v) } : v
			)
		)
		.digest('hex');
}
export function freezeVeArtifact<T>(value: T): Immutable<T> {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freezeVeArtifact(child);
		Object.freeze(value);
	}
	return value as Immutable<T>;
}
export function verifyVeDataset(dataset: VeEvaluationDataset): void {
	const { datasetId, ...content } = dataset;
	if (content.version !== 've-evaluation-phase-a-v1' || datasetId !== veContentHash(content))
		throw new Error('VE dataset content fingerprint mismatch.');
}
