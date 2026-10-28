import { parentPort, workerData } from 'node:worker_threads';
import { analyticalPresentation } from './analyticalPresentation';
import { parseMslWithEligibilityEvidence } from '../msl/parseMslWithEligibilityEvidence';
import { importTunerStudioXml } from '../msl/importTunerStudioXml';
import { prepareVeEvaluationDataset } from '../analysis/prepareVeEvaluation';
import { fitVeCorrections } from '../analysis/fitVeCorrections';
import { evaluateVeCorrectionCandidate } from '../analysis/predictVeCandidate';
import { summarizeAfrErrorRows } from '../analysis/targetAfrError';
import { freezeVeArtifact, veContentHash } from '../analysis/veArtifacts';
import { eligibilityConfig } from '../analysis/sampleEligibility';
import { executeInvestigationTool } from './tools';
import type { AnalyticalSnapshot } from './analyticalSettings';
import type { VeEvaluationDataset } from '../../shared/types/veEvaluation';
import type { VeFitResult } from '../../shared/types/veFitting';
import type {
	AnalyticalEvidenceRef,
	AnalyticalArtifactKind,
	AnalyticalWorkerReply,
	WorkerFact
} from '../../shared/types/analyticalInvestigation';
import type { InspectionContext } from './context';
import type { JsonValue } from '../../shared/types/investigation';

const input = workerData as { runId: string; settingsId: string; snapshot: AnalyticalSnapshot };
const snapshot = freezeVeArtifact(input.snapshot),
	limits = snapshot.settings.limits;
const { session, categorical } = parseMslWithEligibilityEvidence(
	snapshot.logContent,
	snapshot.logName
);
if (session.rowCount > limits.maxRows || session.channels.length > limits.maxChannels)
	throw new Error('Analytical telemetry dimension budget exceeded.');
const ve = snapshot.veXml ? importTunerStudioXml(snapshot.veXml) : null,
	afr = snapshot.afrXml ? importTunerStudioXml(snapshot.afrXml) : null;
for (const table of [ve, afr])
	if (table && table.table.rowCount * table.table.columnCount > limits.maxCells)
		throw new Error('Analytical table cell budget exceeded.');
const missing = [
	...(!ve ? ['VE table'] : []),
	...(!afr ? ['AFR table'] : []),
	...(snapshot.calibrationSemantics ? [] : ['confirmed RPM/MAP-kPa/AFR calibration semantics'])
];
const context: InspectionContext = {
	id: snapshot.contextId,
	logName: snapshot.logName,
	logEncoding: 'provided-string',
	calibrationId: snapshot.calibrationId,
	session,
	ve: ve ?? undefined,
	afr: afr ?? undefined,
	eligibilityProfile: eligibilityConfig(
		snapshot.settings.profile.version === 'steady-afr-ve-v1'
			? snapshot.settings.profile.config
			: snapshot.settings.profile.baseConfig
	),
	limitations: ['Calibration association is caller-supplied.']
};
let dataset: VeEvaluationDataset | undefined,
	fit: VeFitResult | undefined,
	evaluation: ReturnType<typeof evaluateVeCorrectionCandidate> | undefined,
	storedBytes = 0;
const artifacts = new Map<string, { ref: AnalyticalEvidenceRef; value: unknown }>();
function store(
	kind: AnalyticalArtifactKind,
	value: unknown,
	key: string = kind
): AnalyticalEvidenceRef {
	const existing = artifacts.get(key);
	if (existing) return existing.ref;
	const encoded = JSON.stringify(value),
		bytes = Buffer.byteLength(encoded);
	if (storedBytes + bytes > limits.maxArtifactBytes)
		throw new Error('Analytical artifact byte budget exceeded.');
	const ref: AnalyticalEvidenceRef = {
		runId: input.runId,
		contextId: snapshot.contextId,
		settingsId: input.settingsId,
		artifactId: `${input.runId}:${key}`,
		kind,
		sha256: veContentHash(value),
		datasetId: dataset?.datasetId ?? null,
		candidateId: fit?.candidate.candidateId ?? null
	};
	artifacts.set(key, { ref, value });
	storedBytes += bytes;
	return ref;
}
function response(
	data: unknown,
	artifact: AnalyticalEvidenceRef,
	facts: WorkerFact[] = []
): AnalyticalWorkerReply {
	return {
		data: data as JsonValue,
		artifact,
		facts,
		refs: [...artifacts.values()].map((a) => a.ref)
	};
}
function unavailable(): AnalyticalWorkerReply {
	const artifact = store('availability', { missing, calibrationId: snapshot.calibrationId });
	return response({ status: 'unavailable', missing }, artifact, [
		{
			key: 'availability',
			kind: 'availability',
			statement: `Analytical calibration is unavailable: ${missing.join(', ')}. No substitute was used.`,
			values: { missing }
		}
	]);
}
function prepare() {
	if (dataset) return dataset;
	if (!ve || !afr || missing.length) throw new Error('Missing confirmed calibration.');
	const bind = {
		xQuantity: 'engineSpeed' as const,
		xUnit: 'rpm' as const,
		yQuantity: 'manifoldPressure' as const,
		yUnit: 'kPa' as const
	};
	dataset = prepareVeEvaluationDataset({
		session,
		categorical,
		targetAfrTable: {
			...afr,
			...bind,
			sourceId: `${snapshot.calibrationId}:AFR`,
			valueUnit: 'AFR'
		},
		veTable: { ...ve, ...bind, sourceId: `${snapshot.calibrationId}:VE`, valueUnit: 'VE' },
		eligibilityProfile: snapshot.settings.profile,
		config: snapshot.settings.preparation
	});
	if (
		dataset.episodes.filter((e) => e.partition === 'training').length >
			limits.maxTrainingEpisodes ||
		dataset.coverage.supportedCells > limits.maxSupportedCells
	)
		throw new Error('Analytical episode/supported-cell budget exceeded; no fit was performed.');
	store('analysis', dataset);
	return dataset;
}
function indices(
	list: unknown,
	maxX: number,
	maxY: number
): { rpmIndex: number; mapIndex: number }[] | undefined {
	const selected = list as { rpmIndex: number; mapIndex: number }[] | undefined;
	if (selected?.some((p) => p.rpmIndex >= maxX || p.mapIndex >= maxY))
		throw new Error('Requested region is outside the actual table axes.');
	return selected;
}
function requestedRows(list: unknown, allowed: ReadonlySet<number>) {
	const selected = list as number[] | undefined;
	if (selected?.some((id) => !allowed.has(id)))
		throw new Error(
			'Requested row is outside the available evidence partition or is not eligible.'
		);
	return selected;
}
function tool(name: string, args: Record<string, unknown>): AnalyticalWorkerReply {
	if (
		['analyze_afr_error', 'fit_ve_candidate', 'evaluate_ve_candidate'].includes(name) &&
		missing.length
	)
		return unavailable();
	// Reject invalid actual-axis selections before preparing/fitting a dataset.
	if (ve && ['analyze_afr_error', 'fit_ve_candidate', 'evaluate_ve_candidate'].includes(name)) {
		const cells = name === 'fit_ve_candidate';
		indices(
			cells ? args.cells : args.neighborhoods,
			ve.table.columnCount - (cells ? 0 : 1),
			ve.table.rowCount - (cells ? 0 : 1)
		);
		if ((args.rowIndices as number[] | undefined)?.some((row) => row >= session.rowCount))
			throw new Error('Requested row is outside the telemetry.');
	}
	if (name === 'analyze_afr_error') {
		const d = prepare(),
			axes = d.tables.ve.provenance;
		const groups = new Map<string, (typeof d.rows)[number][]>();
		const ready = d.rows.filter((row) => row.partition === 'training' && row.status === 'ready');
		for (const row of ready) {
			if (row.ve.location.status !== 'ok') continue;
			const n = row.ve.location.neighborhood,
				key = `${n.rpmIndex},${n.mapIndex}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(row);
		}
		const selected =
			indices(args.neighborhoods, axes.rpmAxis.length - 1, axes.mapAxisKpa.length - 1) ??
			[...groups.entries()]
				.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
				.slice(0, 8)
				.map(([key]) => {
					const [rpmIndex, mapIndex] = key.split(',').map(Number);
					return { rpmIndex, mapIndex };
				});
		const summaries = selected.map((n) => ({
			...n,
			rpmBounds: [axes.rpmAxis[n.rpmIndex], axes.rpmAxis[n.rpmIndex + 1]],
			mapBoundsKpa: [axes.mapAxisKpa[n.mapIndex], axes.mapAxisKpa[n.mapIndex + 1]],
			summary: summarizeAfrErrorRows(
				(groups.get(`${n.rpmIndex},${n.mapIndex}`) ?? []).map((r) => r.afr)
			)
		}));
		const supportIds = [
			...new Set(
				summaries.flatMap((s) =>
					Object.values(s.summary.supportingRows).filter((v): v is number => v !== null)
				)
			)
		];
		const rowIds =
			requestedRows(
				args.rowIndices,
				new Set(d.rows.filter((r) => r.partition === 'training').map((r) => r.rowIndex))
			) ?? supportIds.slice(0, 3);
		const ref = artifacts.get('analysis')!.ref;
		return response(
			{
				status: 'available',
				analysisRef: ref.artifactId,
				partition: 'training',
				classifier: {
					version: d.manifest.classifierVersion,
					config: d.manifest.classifierConfig,
					baseConfig: d.manifest.baseClassifierConfig
				},
				preparationConfig: d.config,
				partitionCounts: {
					rawTrainingRows: d.rows.filter((r) => r.partition === 'training').length,
					classifierEligibleRows: d.rows.filter(
						(r) => r.partition === 'training' && r.afr.eligibilityStatus === 'eligible'
					).length,
					readyTrainingRows: ready.length
				},
				coverage: d.coverage,
				split: d.split,
				regions: summaries,
				omittedPopulatedRegions: Math.max(
					0,
					groups.size - summaries.filter((s) => s.summary.error.count > 0).length
				),
				supportingRows: rowIds.map((id) => d.rows[id]),
				omittedSupportingRows: supportIds.filter((id) => !rowIds.includes(id)).length,
				limitations: d.limitations
			},
			ref,
			summaries.map((s) => ({
				key: `region-${s.rpmIndex}-${s.mapIndex}`,
				kind: 'afr-error',
				statement: `Training VE neighborhood RPM ${s.rpmBounds.join('-')}, MAP ${s.mapBoundsKpa.join('-')} kPa has ${s.summary.error.count} eligible observations; measured-minus-target AFR mean ${s.summary.error.mean}, median ${s.summary.error.median}.`,
				values: {
					rpmIndex: s.rpmIndex,
					mapIndex: s.mapIndex,
					count: s.summary.error.count,
					meanError: s.summary.error.mean,
					medianError: s.summary.error.median
				}
			}))
		);
	}
	if (name === 'fit_ve_candidate') {
		const d = prepare();
		if (!fit) {
			fit = fitVeCorrections(d, snapshot.settings.fitting);
			store('fit', fit);
			store('candidate', fit.candidate);
		}
		const counts = {
			supported: d.coverage.supportedCells,
			accepted: 0,
			suppressed: 0,
			unsupported: 0
		};
		const reasonCounts: Record<string, number> = {};
		for (const cell of fit.cells) {
			counts[cell.status]++;
			for (const code of cell.reasons) reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
		}
		const selection = indices(
			args.cells,
			d.tables.ve.provenance.rpmAxis.length,
			d.tables.ve.provenance.mapAxisKpa.length
		);
		const details = selection
			? selection.map((n) =>
					fit!.cells.find((c) => c.rpmIndex === n.rpmIndex && c.mapIndex === n.mapIndex)!
				)
			: fit.cells.filter((c) => c.status !== 'unsupported').slice(0, 8);
		const cells = details.map(({ stability, ...cell }) => ({
			...cell,
			stability: stability
				? {
						minPct: stability.minPct,
						maxPct: stability.maxPct,
						rangePct: stability.rangePct,
						directionStable: stability.directionStable,
						foldCount: stability.foldPercentages.length
					}
				: null
		}));
		const ref = artifacts.get('fit')!.ref;
		return response(
			{
				status: fit.status,
				analysisRef: artifacts.get('analysis')!.ref.artifactId,
				candidateRef: artifacts.get('candidate')!.ref.artifactId,
				counts,
				reasonCounts,
				bounds: fit.bounds,
				config: fit.config,
				cells,
				nonUnsupportedCells: fit.cells
					.filter((c) => c.status !== 'unsupported')
					.map((c) => ({
						rpmIndex: c.rpmIndex,
						mapIndex: c.mapIndex,
						status: c.status,
						reasons: c.reasons
					})),
				omittedCellDetails: fit.cells.length - cells.length,
				passes: fit.passes.map((p) => ({
					pass: p.pass,
					activeCells: p.activeCellIndices.length,
					conditioning: p.conditioning,
					solver: p.solver,
					folds: p.folds.length,
					frozen: p.frozen
				})),
				trainingRows: fit.trainingRows,
				trainingEpisodes: fit.trainingEpisodeIds.length,
				limitations: fit.limitations
			},
			ref,
			[
				{
					key: 'fit-summary',
					kind: 'fit-summary',
					statement: `Training-only fit ${fit.status}: ${counts.accepted} accepted, ${counts.suppressed} suppressed and ${counts.unsupported} unsupported VE cells. These are advisory proposals, not measured improvements or ECU-write authorization.`,
					values: { status: fit.status, ...counts }
				}
			]
		);
	}
	if (name === 'evaluate_ve_candidate') {
		if (!fit) throw new Error('A candidate must be finalized before holdout evaluation.');
		if (!evaluation) {
			evaluation = evaluateVeCorrectionCandidate(dataset!, fit.candidate);
			store('evaluation', evaluation);
		}
		const axes = dataset!.tables.ve.provenance;
		const selection = indices(
			args.neighborhoods,
			axes.rpmAxis.length - 1,
			axes.mapAxisKpa.length - 1
		);
		const neighborhoods = selection
			? evaluation.byNeighborhood.filter((n) =>
					selection.some((s) => s.rpmIndex === n.rpmIndex && s.mapIndex === n.mapIndex)
				)
			: evaluation.byNeighborhood.slice(0, 8);
		const rowIds =
			requestedRows(args.rowIndices, new Set(evaluation.rows.map((r) => r.rowIndex))) ??
			evaluation.rows.slice(0, 3).map((r) => r.rowIndex);
		const p = evaluation.paired,
			ref = artifacts.get('evaluation')!.ref;
		return response(
			{
				status: p.status,
				candidateRef: artifacts.get('candidate')!.ref.artifactId,
				basis: 'conditional-model-prediction',
				paired: p,
				affectedOnly: evaluation.affectedOnly,
				coverage: dataset!.coverage,
				split: dataset!.split,
				neighborhoods,
				omittedNeighborhoods: evaluation.byNeighborhood.length - neighborhoods.length,
				rows: rowIds.map((id) => ({
					...evaluation!.rows.find((r) => r.rowIndex === id)!,
					timeSec: dataset!.rows[id].afr.timeSec,
					rpm: dataset!.rows[id].afr.rpm,
					mapKpa: dataset!.rows[id].afr.mapKpa
				})),
				changedNeighborhoods: evaluation.changedNeighborhoods,
				delay: evaluation.delay,
				limitations: evaluation.limitations
			},
			ref,
			[
				{
					key: 'paired-prediction',
					kind: 'paired-prediction',
					statement: `Conditional held-out model prediction on ${p.rowCount} identical baseline/candidate rows: MAE ${p.baseline.mae} -> ${p.candidate?.mae ?? 'unavailable'}, RMSE ${p.baseline.rmse} -> ${p.candidate?.rmse ?? 'unavailable'}. This is not measured improvement; worsened metrics remain included.`,
					values: {
						rowCount: p.rowCount,
						baselineMae: p.baseline.mae,
						candidateMae: p.candidate?.mae ?? null,
						baselineRmse: p.baseline.rmse,
						candidateRmse: p.candidate?.rmse ?? null
					}
				}
			]
		);
	}
	const result = executeInvestigationTool(context, name, args);
	if (!result.ok) throw new Error(result.error);
	const ref = store(
		'context',
		{ name, args, data: result.data },
		`context-${veContentHash({ name, args })}`
	);
	return response(result.data, ref, [
		{
			key: 'context',
			kind: 'context',
			statement: `The frozen investigation context contains ${session.rowCount} parsed telemetry rows. Inspection statistics alone do not establish fueling causes.`,
			values: { rowCount: session.rowCount }
		}
	]);
}

parentPort!.on(
	'message',
	(message: {
		id: number;
		action: 'tool' | 'read' | 'presentation';
		name?: string;
		args?: Record<string, unknown>;
		artifactId?: string;
	}) => {
		try {
			if (message.action === 'presentation') {
				parentPort!.postMessage({
					id: message.id,
					ok: true,
					value: analyticalPresentation(snapshot.settings.profile.version, dataset, fit, evaluation)
				});
				return;
			}
			if (message.action === 'read') {
				const artifact = [...artifacts.values()].find(
					(a) => a.ref.artifactId === message.artifactId
				);
				if (!artifact) throw new Error('Unknown evidence reference.');
				parentPort!.postMessage({ id: message.id, ok: true, value: artifact.value });
			} else
				parentPort!.postMessage({
					id: message.id,
					ok: true,
					value: tool(message.name!, message.args!)
				});
		} catch (error) {
			parentPort!.postMessage({
				id: message.id,
				ok: false,
				error: error instanceof Error ? error.message : 'Analytical worker failed.'
			});
		}
	}
);
