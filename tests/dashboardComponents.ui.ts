import { render } from 'svelte/server';
import { describe, it, expect } from 'vitest';
import AnalyticalResults from '../src/lib/components/dashboard/AnalyticalResults.svelte';
import InvestigationPanel from '../src/lib/components/dashboard/InvestigationPanel.svelte';
import DemoLoader from '../src/lib/components/dashboard/DemoLoader.svelte';
import VeCandidateGrid from '../src/lib/components/dashboard/VeCandidateGrid.svelte';
import RunProgress from '../src/lib/components/dashboard/RunProgress.svelte';
import InspectionDrawer from '../src/lib/components/dashboard/InspectionDrawer.svelte';
import { DashboardStore } from '../src/lib/server/sessionStore';
import type { InvestigationJob } from '../src/lib/shared/types/dashboard';
import { projectRecording } from '../src/lib/server/recordedInvestigation';
import { context } from './investigation/helpers';
import august from './fixtures/analytical/august-v1-support.json';
import CombinedTelemetryChart from '../src/lib/components/dashboard/CombinedTelemetryChart.svelte';
import TelemetryChart from '../src/lib/components/dashboard/TelemetryChart.svelte';
import TelemetryPanel from '../src/lib/components/dashboard/TelemetryPanel.svelte';
import { telemetryFixture } from './telemetryFixtures';
import { number as displayNumber } from '../src/lib/components/dashboard/presentation';

function job(): InvestigationJob {
	return {
		id: 'j',
		sessionId: 's',
		state: 'finished',
		mode: 'analytical',
		source: 'live',
		profile: 'v1',
		startedAt: 0,
		finishedAt: 1,
		startSec: 0,
		endSec: 60,
		error: null,
		result: {
			status: 'completed',
			reason: null,
			trace: [],
			report: {
				advisoryOnly: true,
				findings: [
					{
						statement: 'Authoritative numerical fact',
						evidenceIds: ['evidence-1'],
						verification: 'server-numerical'
					}
				],
				commentary: [
					{
						kind: 'hypothesis',
						text: 'Unverified possible cause <script>alert(1)</script>',
						evidenceIds: ['evidence-1'],
						verification: 'unverified-model-commentary'
					}
				],
				limitations: ['Not measured improvement.']
			}
		},
		presentation: {
			datasetId: 'd',
			profile: 'v1',
			coverage: {
				trainingRows: 100,
				holdoutRows: 30,
				supportedCells: 1,
				totalCells: 256,
				exclusionCounts: {}
			},
			regions: [],
			cells: [],
			paired: null,
			affectedOnly: null,
			limitations: ['AFR delay remains zero.'],
			omittedCells: 0,
			omittedRegions: 0
		}
	};
}
describe('dashboard server rendering (no browser or API)', () => {
	it('renders exact zero without a trailing circular glyph, while retaining status distinctions and near-zero precision', () => {
		const base = {
			rpmIndex: 0,
			mapIndex: 0,
			rpm: 1000,
			mapKpa: 50,
			status: 'accepted' as const,
			reasons: [],
			finalCorrectionPct: 0,
			atBound: false,
			materialTrainingSamples: 100,
			originalVe: 40,
			proposedVe: 40
		};
		const cells = [
			base,
			{ ...base, rpmIndex: 1, rpm: 1200, finalCorrectionPct: -0 },
			{
				...base,
				rpmIndex: 2,
				rpm: 1500,
				status: 'suppressed' as const,
				reasons: ['LOO_EXCESSIVE_RANGE']
			},
			{ ...base, rpmIndex: 3, rpm: 2000, finalCorrectionPct: 0.00001 },
			{ ...base, rpmIndex: 4, rpm: 2500, status: 'unsupported' as const }
		];
		const html = render(VeCandidateGrid, {
			props: {
				cells,
				axes: { rpm: [1000, 1200, 1500, 2000, 2500, 3000], mapKpa: [50] },
				initialView: 'full',
				onCell: () => {}
			}
		}).body;
		const labels = [
			...html.matchAll(/<button\b[^>]*aria-label="RPM [^>]*>([\s\S]*?)<\/button>/g)
		].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
		expect(labels).toEqual(['0%', '0%', '0%', '+0.000%', '—', '?']);
		expect(html).toContain('0% Evaluated, unchanged.');
		expect(html).toContain('LOO_EXCESSIVE_RANGE');
		expect(html).toContain('Suppressed: proposal withheld');
		expect(html).toContain('not an exact-zero decision');
		expect(html).not.toContain('0.0%0');
		expect(html).not.toContain('○');
		const suppressed = render(VeCandidateGrid, {
			props: { cells: [cells[2]], initialView: 'full', onCell: () => {} }
		}).body;
		expect(suppressed).not.toContain('0% Evaluated, unchanged.');
	});
	it('renders a centered attributed action area with one real runtime progress display and results access', () => {
		const value = job();
		value.state = 'running';
		value.mode = 'legacy';
		const props = {
			available: true,
			job: value,
			starting: false,
			startSec: 0,
			endSec: 60,
			onRun: () => {},
			onCancel: () => {},
			onWindow: () => {},
			onSelect: () => {}
		};
		const html = render(InvestigationPanel, { props }).body;
		expect(html).toContain('Powered by Meta Muse Spark');
		expect(html).toContain('AI investigation action bar');
		expect(html).toContain('Legacy telemetry investigation');
		expect(html.match(/aria-label="Investigation execution"/g)).toHaveLength(1);
		expect(html).toContain('Cancel investigation');
		expect(html).not.toContain('View Results');
		value.state = 'finished';
		value.source = 'recorded';
		value.mode = 'analytical';
		const finished = render(InvestigationPanel, { props }).body;
		expect(finished).toContain('View Results');
		expect(finished).toContain('Recorded Muse Spark demonstration');
	});
	it('keeps downloads in Results with advisory and partial-investigation labels', () => {
		const value = job();
		value.veExport = { available: true };
		value.outcome = 'failed';
		const html = render(AnalyticalResults, { props: { job: value, onSample: () => {} } }).body;
		expect(html).toContain('/api/investigations/j/ve-export?format=csv');
		expect(html).toContain('Partial investigation');
		expect(html).toContain('not a directly importable ECU/TunerStudio calibration');
		expect(html).toContain('Held-out evaluation is unavailable');
		const panel = render(InvestigationPanel, {
			props: {
				available: true,
				job: value,
				starting: false,
				startSec: 0,
				endSec: 60,
				onRun: () => {},
				onCancel: () => {},
				onWindow: () => {},
				onSelect: () => {}
			}
		}).body;
		expect(panel).not.toContain('Download Proposed VE');
		value.veExport = { available: false, reason: 'Recording lacks full candidate data.' };
		const unavailable = render(AnalyticalResults, {
			props: { job: value, onSample: () => {} }
		}).body;
		expect(unavailable).toContain('Recording lacks full candidate data.');
		expect(unavailable).not.toContain('ve-export?format=csv');
	});
	it('defaults to focused with a no-correction state and full-grid access', () => {
		const html = render(VeCandidateGrid, {
			props: { cells: [], axes: { rpm: [800, 1300], mapKpa: [20, 45] }, onCell: () => {} }
		}).body;
		expect(html).toContain('4 cells hidden');
		expect(html).toContain('View full grid');
		expect(html).not.toContain('kPa: unavailable');
	});
	it('renders a deadline and run identity rather than an ambiguous generic failure', () => {
		const value = job();
		value.error =
			'Investigation deadline exceeded (120 seconds) while awaiting model turn 4. Completed evidence is retained.';
		value.termination = { code: 'deadline', phase: 'model', modelTurn: 4, tool: null };
		value.outcome = 'failed';
		value.result!.status = 'timeout';
		const html = render(RunProgress, { props: { job: value, onTrace: () => {} } }).body;
		expect(html).toContain('Deadline exceeded / partial');
		expect(html).toContain('model turn 4');
		expect(html).toContain('Job ID: j');
		expect(html).toContain('Completed evidence is retained');
		expect(html).not.toContain('Provider error');
	});
	it('defaults telemetry to Combined and keeps the Stacked mode control available', () => {
		const data = telemetryFixture(),
			session = new DashboardStore().create('owner', context(), 'april');
		const html = render(TelemetryPanel, {
			props: {
				session,
				data,
				selected: data.slots,
				loading: false,
				onChannels: () => {},
				onWindow: () => {},
				onSelect: () => {}
			}
		}).body;
		expect(html).toContain('Telemetry visualization mode');
		expect(html).toContain('Combined');
		expect(html).toContain('Stacked');
		expect(html).toContain('data-testid="combined-telemetry"');
		expect(html).toMatch(/Physical\s+magnitudes\s+are\s+not\s+comparable/);
	});
	it('renders physical cursor values, original row references, accessible legend toggles and actual gaps', () => {
		const data = telemetryFixture();
		data.segments[0][1].values[2] = null;
		const html = render(CombinedTelemetryChart, {
			props: {
				data,
				cursor: 1,
				hidden: ['load'],
				onCursor: () => {},
				onToggle: () => {},
				onWindow: () => {},
				onSelect: () => {}
			}
		}).body;
		expect(html).toContain(`Nearest row 11 at ${displayNumber(1, 3)} s`);
		expect(html.replace(/\s+/g, ' ')).toContain(`${displayNumber(1800)} rpm`);
		expect(html.replace(/\s+/g, ' ')).toContain(`${displayNumber(60)} kPa`);
		expect(html.replace(/\s+/g, ' ')).toContain(`${displayNumber(15)} %`);
		expect(html).toContain('Manifold pressure curve visibility');
		expect(html).toContain('aria-pressed="false"');
		expect(html).toContain('Click a sample');
		expect(html).not.toContain('NaN');
		expect(html).not.toContain('Infinity');
		// AFR has two isolated finite points, represented as dots rather than a connecting path.
		expect(html.match(/r="2"/g)).toHaveLength(2);
	});
	it('places Combined markers in an unscaled pixel-radius overlay across window changes', () => {
		const data = telemetryFixture();
		for (const [start, end] of [
			[0, 2],
			[0.5, 1.5]
		]) {
			data.startSec = start;
			data.endSec = end;
			const html = render(CombinedTelemetryChart, {
				props: {
					data,
					cursor: 1,
					hidden: [],
					onCursor: () => {},
					onToggle: () => {},
					onWindow: () => {},
					onSelect: () => {}
				}
			}).body;
			const svgs = [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
			expect(svgs).toHaveLength(2);
			expect(svgs[0][1]).toContain('viewBox="0 0 1000 120"');
			expect(svgs[0][2]).not.toContain('<circle');
			expect(svgs[1][1]).toContain('data-testid="combined-marker-overlay"');
			expect(svgs[1][1]).toContain('pointer-events-none');
			expect(svgs[1][1]).not.toMatch(/viewBox|transform=/);
			const markers = [
				...svgs[1][2].matchAll(/<circle\b[^>]*cx="([^"]+)%"[^>]*cy="([^"]+)%"[^>]*r="3"/g)
			];
			expect(markers).toHaveLength(4);
			for (const marker of markers) {
				expect(Number(marker[1])).toBeCloseTo(50, 10);
				expect(Number(marker[2])).toBeCloseTo(50, 10);
			}
		}
	});
	it('preserves the existing stacked physical scaling and interaction affordances', () => {
		const data = telemetryFixture();
		const html = render(TelemetryChart, {
			props: {
				data,
				index: 0,
				cursor: 1,
				onCursor: () => {},
				onWindow: () => {},
				onSelect: () => {}
			}
		}).body;
		expect(html).toContain('rpm');
		expect(html).toContain('1,800');
		expect(html).toContain('3,040');
		expect(html).toContain('560');
		expect(html).toContain('M0.00,100.32 L500.00,60.00 L1000.00,19.68');
		expect(html).toContain('drag to select a time window, or use arrow keys');
	});
	it('renders a complete actual-axis grid without fabricating partial recording decisions', () => {
		const value = projectRecording(august, 'august8', 'v1', {
			...context(),
			logName: '2026-08-08_11.19.56.msl',
			calibrationId: 'block2-calibration'
		}).presentation;
		const html = render(VeCandidateGrid, {
			props: {
				cells: value.cells,
				axes: value.veAxes,
				omittedCells: value.omittedCells,
				initialView: 'full',
				onCell: () => {}
			}
		}).body;
		expect(value.veAxes?.rpm).toHaveLength(16);
		expect(value.veAxes?.mapKpa).toHaveLength(16);
		expect(html.match(/aria-label="RPM /g)).toHaveLength(256);
		// This compact support-count fixture retains no individual decisions.
		expect(value.cells).toHaveLength(0);
		expect(html.match(/kPa: unavailable/g)).toHaveLength(256);
		expect(html).toContain('not unsupported');
		expect(html).not.toContain('clamped');
	});
	it('distinguishes retained accepted, suppressed and unsupported decisions from unavailable cells', () => {
		const base = {
			rpmIndex: 0,
			mapIndex: 0,
			rpm: 800,
			mapKpa: 20,
			status: 'accepted' as const,
			reasons: [],
			finalCorrectionPct: 3,
			atBound: true,
			materialTrainingSamples: 100,
			originalVe: 100,
			proposedVe: 103
		};
		const html = render(VeCandidateGrid, {
			props: {
				axes: { rpm: [800, 1300], mapKpa: [20, 45] },
				cells: [
					base,
					{
						...base,
						rpmIndex: 1,
						rpm: 1300,
						status: 'suppressed',
						reasons: ['DIRECTION_UNSTABLE'],
						finalCorrectionPct: 0,
						atBound: false,
						proposedVe: 100
					},
					{
						...base,
						mapIndex: 1,
						mapKpa: 45,
						status: 'unsupported',
						finalCorrectionPct: 0,
						atBound: false,
						proposedVe: 100
					}
				],
				onCell: () => {}
			}
		}).body;
		expect(html).toContain(`kPa: accepted, ${displayNumber(3, 3)} percent, at bound`);
		expect(html).toContain('kPa: suppressed');
		expect(html).toContain('kPa: unsupported');
		expect(html.match(/kPa: unavailable/g)).toHaveLength(1);
		expect(html).not.toContain('clamped');
	});
	it('shows genuine polled progress and retained calls without claiming completion', () => {
		const value = job();
		value.state = 'running';
		value.result = null;
		value.progress = { phase: 'executing-tool', tool: 'fit_ve_candidate', completed: [] };
		const html = render(RunProgress, { props: { job: value, onTrace: () => {} } }).body;
		expect(html).toContain('executing tool');
		expect(html).toContain('fit ve candidate');
		expect(html).toContain('0 completed calls');
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain('evaluate ve candidate');
	});
	it('opens the exact trace evidence and preserves legacy row/window navigation in the drawer', () => {
		const value = job();
		value.result!.trace = [
			{
				evidenceId: 'evidence-actual',
				tool: 'summarize_window',
				arguments: { startSec: 1, endSec: 2 },
				result: { ok: true, data: { samples: [{ rowIndex: 7 }] } }
			}
		];
		const session = new DashboardStore().create('owner', context(), 'april');
		const html = render(InspectionDrawer, {
			props: {
				open: true,
				section: 'trace',
				session,
				page: null,
				loading: false,
				status: '',
				reason: '',
				includeInvalidTime: false,
				job: value,
				selectedEvidenceId: 'evidence-actual',
				onClose: () => {},
				onSection: () => {},
				onEvidence: () => {},
				onFilter: () => {},
				onPage: () => {},
				onSelect: () => {},
				onLocate: () => {},
				onSample: () => {},
				onWindow: () => {}
			}
		}).body;
		expect(html).toContain('evidence-actual');
		expect(html).toMatch(/<details[^>]*open/);
		expect(html).toContain(`View ${displayNumber(1)}-${displayNumber(2)} s on timeline`);
		expect(html).toContain('Row 7');
		expect(html).toContain('not hidden model reasoning');
	});
	it('renders the recorded August support count and explicit log identity even without cell detail rows', () => {
		const value = job();
		value.logName = '2026-08-08_11.19.56.msl';
		value.calibrationId = 'block2-calibration';
		value.rowCount = 56284;
		value.source = 'recorded';
		value.presentation = projectRecording(august, 'august8', 'v1', {
			...context(),
			logName: value.logName,
			calibrationId: value.calibrationId
		}).presentation;
		const html = render(AnalyticalResults, { props: { job: value, onSample: () => {} } }).body;
		expect(html).toContain('2026-08-08_11.19.56.msl');
		expect(html).toContain('block2-calibration');
		expect(html.split('data-testid="supported-ve-cells"')[1].split('</strong>')[0]).toMatch(
			/5\s*\/\s*256/
		);
	});
	it('blocks a new investigation when the chosen demo has not been loaded', () => {
		const props = {
			available: true,
			job: null,
			starting: false,
			startSec: 0,
			endSec: 60,
			onRun: () => {},
			onCancel: () => {},
			onWindow: () => {},
			onSelect: () => {},
			pendingDemo: true,
			loadedLogName: '2025-04-12_16.16.28.msl'
		};
		const html = render(InvestigationPanel, { props }).body;
		expect(html).toContain('Load the selected demo before starting');
		expect(html).toContain('2025-04-12_16.16.28.msl');
		expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Run investigation/);
	});
	it('distinguishes authoritative numerical findings from escaped unverified commentary', () => {
		const html = render(AnalyticalResults, { props: { job: job(), onSample: () => {} } }).body;
		expect(html).toContain('Server-verified numerical fact');
		expect(html).toContain('Unverified model hypothesis');
		expect(html).toContain('Live Muse Spark');
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script');
	});
	it('labels recordings as historical without presenting them as live execution', () => {
		const value = job();
		value.source = 'recorded';
		value.recordedAt = '2026-10-28T09:00:00Z';
		const html = render(AnalyticalResults, { props: { job: value, onSample: () => {} } }).body;
		expect(html).toContain('Recorded demonstration');
		expect(html).toContain('No live model request');
		expect(html).toContain('Recorded server fact');
	});
	it('shows failed/partial and cancellation honestly when no final report is available', () => {
		const value = job();
		value.result = null;
		value.error = 'The worker stopped.';
		expect(render(AnalyticalResults, { props: { job: value, onSample: () => {} } }).body).toContain(
			'Failed / partial'
		);
		value.outcome = 'cancelled';
		expect(render(AnalyticalResults, { props: { job: value, onSample: () => {} } }).body).toContain(
			'Cancelled'
		);
	});
	it('renders completed calls and cancel controls during a live investigation', () => {
		const value = job();
		value.state = 'running';
		value.progress = {
			phase: 'awaiting-model',
			tool: null,
			completed: [
				{
					evidenceId: 'evidence-1',
					tool: 'fit_ve_candidate',
					arguments: {},
					result: { ok: true, data: {} }
				}
			]
		};
		const html = render(InvestigationPanel, {
			props: {
				available: true,
				job: value,
				starting: false,
				startSec: 0,
				endSec: 60,
				onRun: () => {},
				onCancel: () => {},
				onWindow: () => {},
				onSelect: () => {}
			}
		}).body;
		expect(html).toContain('fit ve candidate');
		expect(html).toContain('Cancel investigation');
	});
	it('offers both curated demos through a named selector', () => {
		const html = render(DemoLoader, {
			props: {
				session: null,
				loading: false,
				onload: () => {},
				datasets: [
					{ id: 'april', label: 'April 12', available: true },
					{ id: 'august8', label: 'August 8', available: true }
				]
			}
		}).body;
		expect(html).toContain('Curated dataset');
		expect(html).toContain('April 12');
		expect(html).toContain('August 8');
	});
	it('formats candidate percentages for display without mutating stored precision', () => {
		const value = job();
		value.presentation!.cells = [
			{
				rpmIndex: 0,
				mapIndex: 0,
				rpm: 1000,
				mapKpa: 45,
				originalVe: 100.123456,
				proposedVe: 101.234567,
				finalCorrectionPct: 1.234567,
				status: 'accepted',
				reasons: [],
				atBound: false,
				materialTrainingSamples: 100
			}
		];
		const html = render(AnalyticalResults, {
			props: { job: value, onSample: () => {}, initialSection: 'VE candidate' }
		}).body;
		expect(html).toContain('1.235%');
		expect(html).toContain('100.123');
		expect(html).toContain('101.235');
		expect(value.presentation!.cells[0].finalCorrectionPct).toBe(1.234567);
	});
	it('renders held-out paired metrics with explicit prediction limitations', () => {
		const value = job();
		const errors = {
			count: 30,
			mean: 0,
			median: 0,
			populationStdDev: 0,
			q25: 0,
			q75: 0,
			iqr: 0,
			mad: 0,
			min: 0,
			max: 0
		};
		value.presentation!.paired = {
			status: 'complete',
			rowCount: 30,
			failedPredictions: 0,
			baseline: { count: 30, mae: 1.234567, rmse: 2.345678, errors },
			candidate: { count: 30, mae: 1.456789, rmse: 2.567891, errors },
			predictedDeltaMae: 0.222222,
			predictedDeltaRmse: 0.222213
		};
		const html = render(AnalyticalResults, {
			props: { job: value, onSample: () => {}, initialSection: 'Holdout evaluation' }
		}).body;
		expect(html).toContain('1.2346');
		expect(html).toContain('1.4568');
		expect(html).toContain('not measured improvements');
		expect(html).toContain('0 ms');
		expect(html).toContain('worsened metrics');
	});
});
