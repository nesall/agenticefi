import { render } from 'svelte/server';
import { describe, it, expect } from 'vitest';
import AnalyticalResults from '../src/lib/components/dashboard/AnalyticalResults.svelte';
import InvestigationPanel from '../src/lib/components/dashboard/InvestigationPanel.svelte';
import DemoLoader from '../src/lib/components/dashboard/DemoLoader.svelte';
import type { InvestigationJob } from '../src/lib/shared/types/dashboard';
import { projectRecording } from '../src/lib/server/recordedInvestigation';
import { context } from './investigation/helpers';
import august from './fixtures/analytical/august-v1-support.json';

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
		expect(html).toMatch(/<button[^>]*disabled[^>]*>Run investigation/);
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
