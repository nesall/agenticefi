import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type {
	DemoId,
	AnalyticalProfile,
	AnalyticalPresentation,
	DashboardAfrRegion,
	DashboardVeCell
} from '../shared/types/analyticalDashboard';
import type { InvestigationResult } from '../shared/types/investigation';
import type { InvestigationContext } from './investigation/context';
import { assertCoverageSupport } from './investigation/coverageConsistency';

function recordingPath(id: DemoId, profile: AnalyticalProfile) {
	const file = `${id === 'august8' ? 'august' : 'april'}-${profile === 'v1' ? 'v1' : 'v2'}-live-smoke.json`;
	return [`.demo-assets/recordings/${file}`, `reports/analytical-tools/${file}`].find(
		(p) => existsSync(p) && statSync(p).size <= 1024 * 1024
	);
}
export function recordedProfiles(id: DemoId): AnalyticalProfile[] {
	return (['v1', 'v2-experimental'] as const).filter((p) => !!recordingPath(id, p));
}
const obj = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Server-owned historical snapshots only; no browser-supplied files or paths. */
export async function recordedInvestigation(
	id: DemoId,
	profile: AnalyticalProfile,
	context: InvestigationContext
) {
	const path = recordingPath(id, profile);
	if (!path) throw new Error('Recording unavailable.');
	return projectRecording(JSON.parse(await readFile(path, 'utf8')), id, profile, context);
}
export function projectRecording(
	value: unknown,
	id: DemoId,
	profile: AnalyticalProfile,
	context: InvestigationContext
) {
	const root = obj(value),
		selection = obj(root.selection),
		sources = obj(selection.sources);
	const result = root.validatedInvestigation as InvestigationResult | undefined;
	if (
		root.model !== 'muse-spark-1.3-contributor' ||
		root.outcome !== 'passed' ||
		selection.dataset !== (id === 'august8' ? 'august' : 'april') ||
		selection.profile !== (profile === 'v1' ? 'v1' : 'v2') ||
		sources.calibrationId !== context.calibrationId ||
		typeof sources.log !== 'string' ||
		(id === 'august8' && !sources.log.endsWith(context.logName)) ||
		!result ||
		result.status !== 'completed' ||
		!Array.isArray(result.trace) ||
		result.trace.length > 6 ||
		!result.report ||
		!Array.isArray(result.report.findings) ||
		!Array.isArray(result.report.limitations) ||
		typeof root.startedAt !== 'string' ||
		!Number.isFinite(Date.parse(root.startedAt))
	)
		throw new Error('Recording failed identity or schema validation.');
	if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
		throw new Error('Recorded result byte budget exceeded.');
	if (
		result.report.advisoryOnly !== true ||
		result.report.limitations.length > 40 ||
		!result.report.limitations.every((s) => typeof s === 'string' && s.length <= 5000) ||
		(result.report.commentary !== undefined &&
			(!Array.isArray(result.report.commentary) || result.report.commentary.length > 10)) ||
		result.trace.some(
			(t) =>
				typeof t.tool !== 'string' ||
				t.tool.length > 100 ||
				!/^evidence-[1-9]\d?$/.test(t.evidenceId) ||
				typeof t.result?.ok !== 'boolean'
		)
	)
		throw new Error('Invalid recorded trace or report.');
	const successful = new Set(result.trace.filter((t) => t.result?.ok).map((t) => t.evidenceId));
	if (
		result.report.findings.length > 20 ||
		result.report.findings.some(
			(f) =>
				typeof f.statement !== 'string' ||
				f.statement.length > 5000 ||
				f.verification !== 'server-numerical' ||
				!Array.isArray(f.evidenceIds) ||
				!f.evidenceIds.length ||
				!f.evidenceIds.every((e) => successful.has(e))
		) ||
		(result.report.commentary ?? []).some(
			(c) =>
				c.verification !== 'unverified-model-commentary' ||
				typeof c.text !== 'string' ||
				c.text.length > 1000 ||
				!Array.isArray(c.evidenceIds) ||
				!c.evidenceIds.length ||
				!c.evidenceIds.every((e) => successful.has(e))
		)
	)
		throw new Error('Recording citations or verification labels are invalid.');
	const data = (tool: string) => {
		const entry = result.trace.find((t) => t.tool === tool && t.result.ok);
		return obj(entry?.result.ok ? entry.result.data : null);
	};
	const analysis = data('analyze_afr_error'),
		fit = data('fit_ve_candidate'),
		evaluation = data('evaluate_ve_candidate');
	assertCoverageSupport(analysis.coverage, obj(fit.counts).supported);
	assertCoverageSupport(evaluation.coverage, obj(fit.counts).supported);
	const regions: DashboardAfrRegion[] = (Array.isArray(analysis.regions) ? analysis.regions : [])
		.slice(0, 8)
		.map((r) => {
			const region = obj(r);
			if (
				!Number.isInteger(region.rpmIndex) ||
				!Number.isInteger(region.mapIndex) ||
				!Array.isArray(region.rpmBounds) ||
				!Array.isArray(region.mapBoundsKpa) ||
				region.rpmBounds.length !== 2 ||
				region.mapBoundsKpa.length !== 2 ||
				![...region.rpmBounds, ...region.mapBoundsKpa].every(
					(n) => typeof n === 'number' && Number.isFinite(n)
				) ||
				typeof obj(obj(region.summary).error).count !== 'number'
			)
				throw new Error('Invalid recorded region.');
			return {
				rpmIndex: region.rpmIndex as number,
				mapIndex: region.mapIndex as number,
				rpmBounds: region.rpmBounds,
				mapBoundsKpa: region.mapBoundsKpa,
				summary: region.summary as DashboardAfrRegion['summary'],
				samples: []
			};
		});
	const table = context.ve.table.toJSON();
	const cells: DashboardVeCell[] = (Array.isArray(fit.cells) ? fit.cells : [])
		.slice(0, 8)
		.map((value) => {
			const c = obj(value),
				x = Number(c.rpmIndex),
				y = Number(c.mapIndex);
			if (
				!Number.isInteger(x) ||
				!Number.isInteger(y) ||
				x < 0 ||
				y < 0 ||
				x >= table.xBreakpoints.length ||
				y >= table.yBreakpoints.length ||
				!['accepted', 'suppressed', 'unsupported'].includes(String(c.status)) ||
				!Array.isArray(c.reasons) ||
				!c.reasons.every((r) => typeof r === 'string') ||
				typeof c.finalCorrectionPct !== 'number'
			)
				throw new Error('Invalid recorded cell.');
			return {
				rpmIndex: x,
				mapIndex: y,
				rpm: table.xBreakpoints[x],
				mapKpa: table.yBreakpoints[y],
				originalVe: table.values[y][x],
				proposedVe: null,
				status: c.status as DashboardVeCell['status'],
				reasons: c.reasons,
				finalCorrectionPct: c.finalCorrectionPct,
				atBound: c.atBound === true,
				materialTrainingSamples: Number(c.materialTrainingSamples)
			};
		});
	const presentation: AnalyticalPresentation = {
		veAxes: { rpm: [...table.xBreakpoints], mapKpa: [...table.yBreakpoints] },
		datasetId: null,
		profile,
		coverage: (analysis.coverage ?? null) as AnalyticalPresentation['coverage'],
		regions,
		cells,
		paired: (evaluation.paired ?? null) as AnalyticalPresentation['paired'],
		affectedOnly: (evaluation.affectedOnly ?? null) as AnalyticalPresentation['affectedOnly'],
		limitations: [
			...result.report.limitations,
			'Historical smoke recording. Some cell/sample details and proposed VE values were not retained; they are unavailable here. Launch live mode for full details.'
		],
		omittedRegions: Number(analysis.omittedPopulatedRegions ?? 0),
		omittedCells: Math.max(
			0,
			context.ve.table.rowCount * context.ve.table.columnCount - cells.length
		)
	};
	return { result, presentation, recordedAt: root.startedAt };
}
