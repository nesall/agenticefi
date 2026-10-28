import type { JsonValue } from './investigation';

export type AnalyticalArtifactKind =
	'analysis' | 'fit' | 'candidate' | 'evaluation' | 'availability' | 'context';
export type AnalyticalEvidenceRef = {
	runId: string;
	contextId: string;
	settingsId: string;
	artifactId: string;
	kind: AnalyticalArtifactKind;
	sha256: string;
	datasetId: string | null;
	candidateId: string | null;
};
export type AnalyticalFact = {
	id: string;
	evidenceId: string;
	artifact: AnalyticalEvidenceRef;
} & (
	| {
			kind: 'afr-error';
			statement: string;
			values: {
				rpmIndex: number;
				mapIndex: number;
				count: number;
				meanError: number | null;
				medianError: number | null;
			};
	  }
	| {
			kind: 'fit-summary';
			statement: string;
			values: {
				status: string;
				supported: number;
				accepted: number;
				suppressed: number;
				unsupported: number;
			};
	  }
	| {
			kind: 'paired-prediction';
			statement: string;
			values: {
				rowCount: number;
				baselineMae: number | null;
				candidateMae: number | null;
				baselineRmse: number | null;
				candidateRmse: number | null;
			};
	  }
	| { kind: 'availability'; statement: string; values: { missing: readonly string[] } }
	| { kind: 'context'; statement: string; values: { rowCount: number } }
);
type WithoutProvenance<T> = T extends AnalyticalFact
	? Omit<T, 'id' | 'evidenceId' | 'artifact'> & { key: string }
	: never;
export type WorkerFact = WithoutProvenance<AnalyticalFact>;
export type AnalyticalWorkerReply = {
	data: JsonValue;
	artifact: AnalyticalEvidenceRef;
	facts: WorkerFact[];
	refs: AnalyticalEvidenceRef[];
};
