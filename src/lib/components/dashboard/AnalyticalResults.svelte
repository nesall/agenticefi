<script lang="ts">
	import { untrack } from 'svelte';
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import type { SupportingSample } from '../../shared/types/analyticalDashboard';
	import type { JsonValue } from '../../shared/types/investigation';
	import { number } from './presentation';
	type Section =
		'Findings' | 'AFR neighborhoods' | 'VE candidate' | 'Holdout evaluation' | 'Tool trace';
	let {
		job,
		onSample,
		initialSection = 'Findings'
	}: {
		job: InvestigationJob;
		onSample: (sample: SupportingSample) => void;
		initialSection?: Section;
	} = $props();
	let tab = $state(untrack(() => initialSection)),
		evidence = $state<string | null>(null),
		cells = $state('supported');
	const tabs: Section[] = [
		'Findings',
		'AFR neighborhoods',
		'VE candidate',
		'Holdout evaluation',
		'Tool trace'
	];
	const presentation = $derived(job.presentation);
	const trace = $derived(job.result?.trace ?? job.progress?.completed ?? []);
	const report = $derived(job.result?.report);
	const status = $derived(
		job.state === 'running'
			? 'Running'
			: job.outcome === 'cancelled' || job.result?.status === 'cancelled'
				? 'Cancelled'
				: job.result?.status === 'completed' && !job.error
					? 'Completed'
					: 'Failed / partial'
	);
	function inspect(id: string) {
		evidence = id;
		tab = 'Tool trace';
	}
	function samplesFor(statement: string, ids: string[]): SupportingSample[] {
		for (const entry of trace) {
			if (!entry.result.ok || !ids.includes(entry.evidenceId)) continue;
			const data = entry.result.data as Record<string, JsonValue>;
			if (!data || typeof data !== 'object' || !Array.isArray(data.facts)) continue;
			for (const raw of data.facts) {
				if (
					!raw ||
					typeof raw !== 'object' ||
					Array.isArray(raw) ||
					raw.statement !== statement ||
					!raw.values ||
					typeof raw.values !== 'object' ||
					Array.isArray(raw.values)
				)
					continue;
				const region = presentation?.regions.find(
					(r) =>
						r.rpmIndex === (raw.values as Record<string, JsonValue>).rpmIndex &&
						r.mapIndex === (raw.values as Record<string, JsonValue>).mapIndex
				);
				if (region) return region.samples;
			}
		}
		return [];
	}
</script>

<section
	class="panel analytical-results"
	aria-label="Analytical investigation results"
	aria-busy={job.state === 'running'}
>
	<div class="results-heading">
		<div>
			<div class="eyebrow">AFR / VE · ADVISORY ANALYSIS</div>
			<h2>Evidence before correction</h2>
		</div>
		<span class="source-badge" class:recorded={job.source === 'recorded'}
			>{job.source === 'recorded' ? 'Recorded demonstration' : 'Live Muse Spark'} · {status}</span
		>
	</div>
	<p class="intro" data-testid="analysis-log-identity">
		Analysis log: <strong>{job.logName ?? 'Identity unavailable for this older run'}</strong
		>{#if job.calibrationId}
			· Calibration: {job.calibrationId}{/if}{#if job.rowCount !== undefined}
			· {number(job.rowCount, 0)} rows{/if}
	</p>
	<p class="intro">
		{job.profile === 'v2-experimental' ? 'V2 experimental' : 'V1'} · Whole-log training and time-separated
		holdout. Predicted changes are not measured improvements. No ECU writes.
	</p>
	{#if job.source === 'recorded'}<p class="notice">
			Historical result captured {job.recordedAt ?? 'at an unavailable time'}. No live model request
			was made for this display.
		</p>{/if}
	{#if job.error}<p class="notice error" role="alert">{job.error}</p>{/if}
	{#if presentation?.coverage}<div class="coverage">
			<div>
				<span>Training samples</span><strong>{number(presentation.coverage.trainingRows, 0)}</strong
				>
			</div>
			<div>
				<span>Held-out samples</span><strong>{number(presentation.coverage.holdoutRows, 0)}</strong>
			</div>
			<div>
				<span
					title="Cells with enough qualifying training observations and episodes to attempt fitting."
					>Supported VE cells</span
				><strong data-testid="supported-ve-cells"
					>{number(presentation.coverage.supportedCells, 0)} / {presentation.coverage
						.totalCells}</strong
				>
			</div>
			<div>
				<span>Accepted proposals</span><strong
					>{presentation.cells.filter((c) => c.status === 'accepted')
						.length}{presentation.omittedCells ? ' shown' : ''}</strong
				>
			</div>
		</div>{/if}
	<nav class="result-tabs" aria-label="Analytical result sections">
		{#each tabs as label (label)}<button
				class:active={tab === label}
				aria-pressed={tab === label}
				onclick={() => (tab = label)}>{label}</button
			>{/each}
	</nav>
	<div class="result-content">
		{#if tab === 'Findings'}
			{#if !report}<p class="muted">
					{job.state === 'running'
						? 'Muse is investigating. Completed tool calls are available in the trace.'
						: 'No validated final report. Inspect the trace for failed calls and available partial evidence.'}
				</p>{/if}
			{#each report?.findings ?? [] as finding, i (i)}<article class="finding">
					<span class="fact-tag"
						>{job.source === 'recorded'
							? 'Recorded server fact'
							: 'Server-verified numerical fact'}</span
					>
					<p>{finding.statement}</p>
					<div class="evidence-links">
						{#each finding.evidenceIds as id (id)}<button onclick={() => inspect(id)}
								>Inspect {id} ↗</button
							>{/each}
						{#each samplesFor(finding.statement, finding.evidenceIds) as sample (sample.rowIndex)}<button
								onclick={() => onSample(sample)}
								>View row {sample.rowIndex} · {number(sample.timeSec, 3)} s ↗</button
							>{/each}
					</div>
				</article>{/each}
			{#each report?.commentary ?? [] as comment, i (i)}<article class="finding commentary">
					<span class="comment-tag">Unverified model {comment.kind}</span>
					<p>{comment.text}</p>
					<div class="evidence-links">
						{#each comment.evidenceIds as id (id)}<button onclick={() => inspect(id)}
								>Supporting {id} ↗</button
							>{/each}
					</div>
				</article>{/each}
		{:else if tab === 'AFR neighborhoods'}
			<h3>Training AFR error by VE interpolation neighborhood</h3>
			<p class="muted">
				Signed error is measured AFR minus interpolated target AFR. Neighborhoods share influence
				across neighboring VE cells.
			</p>
			{#if !presentation?.regions.length}<p class="notice">
					AFR region evidence is unavailable. The agent may not have completed analysis.
				</p>{:else}<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>RPM</th><th>MAP · kPa</th><th>Samples</th><th>Mean error · AFR</th><th
									>Median · AFR</th
								><th>Std dev · AFR</th><th>Supporting telemetry</th></tr
							></thead
						><tbody
							>{#each presentation.regions as region (`${region.rpmIndex}-${region.mapIndex}`)}<tr
									><td>{region.rpmBounds.map((n) => number(n, 0)).join('–')}</td><td
										>{region.mapBoundsKpa.map((n) => number(n)).join('–')}</td
									><td>{number(region.summary.error.count, 0)}</td><td
										>{number(region.summary.error.mean, 3)}</td
									><td>{number(region.summary.error.median, 3)}</td><td
										>{number(region.summary.error.populationStdDev, 3)}</td
									><td
										>{#each region.samples as sample (sample.rowIndex)}<button
												class="sample-link"
												onclick={() => onSample(sample)}
												>Row {sample.rowIndex} · {number(sample.timeSec, 3)} s ↗</button
											>{:else}<span class="muted">Not retained in recording</span>{/each}</td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>{/if}
			{#if presentation?.omittedRegions}<p class="muted">
					{presentation.omittedRegions} additional regions were not retained in this recording.
				</p>{/if}
		{:else if tab === 'VE candidate'}
			<div class="cell-heading">
				<h3>Frozen bounded candidate</h3>
				<label
					>Show <select class="select" bind:value={cells}
						><option value="supported">Accepted & suppressed</option><option value="all"
							>All cells</option
						><option value="unsupported">Unsupported</option></select
					></label
				>
			</div>
			<p class="muted">
				Unsupported and suppressed cells remain unchanged. A zero-correction outcome is valid.
				Suggestions are advisory.
			</p>
			{#if !presentation?.cells.length}<p class="notice">
					Candidate details are unavailable. No candidate is invented.
				</p>{:else}<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>RPM</th><th>MAP · kPa</th><th>Original VE</th><th>Suggested %</th><th
									>Proposed VE</th
								><th>Status</th><th>Training samples</th><th>Reasons</th></tr
							></thead
						><tbody
							>{#each presentation.cells.filter((c) => cells === 'all' || (cells === 'supported' ? c.status !== 'unsupported' : c.status === 'unsupported')) as cell (`${cell.rpmIndex}-${cell.mapIndex}`)}<tr
									><td>{number(cell.rpm, 0)}</td><td>{number(cell.mapKpa)}</td><td
										>{number(cell.originalVe, 3)}</td
									><td>{number(cell.finalCorrectionPct, 3)}%{cell.atBound ? ' · bound' : ''}</td><td
										>{number(cell.proposedVe, 3)}</td
									><td
										><span class="cell-status" class:accepted={cell.status === 'accepted'}
											>{cell.status}</span
										></td
									><td>{number(cell.materialTrainingSamples, 0)}</td><td class="reasons"
										>{cell.reasons.map((r) => r.replaceAll('_', ' ').toLowerCase()).join(', ') ||
											(cell.status === 'accepted'
												? 'Evidence and stability gates passed'
												: 'No reason retained')}</td
									></tr
								>{:else}<tr><td colspan="8">No cells in this category.</td></tr>{/each}</tbody
						>
					</table>
				</div>{/if}
			{#if presentation?.omittedCells}<p class="notice">
					{presentation.omittedCells} cell details and proposed VE values were not retained in this historical
					recording.
				</p>{/if}
		{:else if tab === 'Holdout evaluation'}
			<h3>Held-out conditional model prediction</h3>
			<p class="muted">
				Baseline and finalized candidate use identical evaluation rows. Holdout outcomes did not
				select thresholds or fitting parameters.
			</p>
			{#if presentation?.paired}{@const paired = presentation.paired}
				<p>
					<strong>{number(paired.rowCount, 0)}</strong> evaluation rows · {paired.status} · {paired.failedPredictions}
					failed predictions
				</p>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Model-based metric · AFR</th><th>Unchanged-table baseline</th><th
									>Finalized candidate</th
								></tr
							></thead
						><tbody
							><tr
								><th>MAE</th><td>{number(paired.baseline.mae, 4)}</td><td
									>{number(paired.candidate?.mae, 4)}</td
								></tr
							><tr
								><th>RMSE</th><td>{number(paired.baseline.rmse, 4)}</td><td
									>{number(paired.candidate?.rmse, 4)}</td
								></tr
							></tbody
						>
					</table>
				</div>
				<p class="notice">
					These are predictions under proportional-fueling assumptions. AFR sensor delay
					compensation is unimplemented at 0 ms. Unchanged or worsened metrics are legitimate
					outcomes.
				</p>{:else}<p class="notice">
					Holdout metrics are unavailable. Evaluation requires a finalized candidate and supporting
					evidence.
				</p>{/if}
		{:else}
			<h3>Agent tool trace</h3>
			<p class="muted">
				Actual model-selected calls and deterministic server replies. References establish
				provenance, not proof of engine causality.
			</p>
			{#each trace as entry (entry.evidenceId)}<details
					class="trace-entry"
					open={evidence === entry.evidenceId}
				>
					<summary
						>{entry.result.ok ? '✓' : '!'}
						{entry.tool.replaceAll('_', ' ')} · {entry.evidenceId}</summary
					>
					<h4>Arguments</h4>
					<pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
					<h4>{entry.result.ok ? 'Deterministic server evidence' : 'Tool failure'}</h4>
					<pre>{JSON.stringify(entry.result, null, 2)}</pre>
				</details>{:else}<p class="muted">No completed calls yet.</p>{/each}
		{/if}
		{#if presentation?.limitations.length ?? report?.limitations.length}<details
				class="result-limitations"
			>
				<summary>Limitations and assumptions</summary>
				<ul>
					{#each presentation?.limitations ?? report?.limitations ?? [] as limitation, i (i)}<li>
							{limitation}
						</li>{/each}
				</ul>
			</details>{/if}
	</div>
</section>

<style>
	.analytical-results {
		margin-top: 1.5rem;
		min-width: 0;
		max-width: 100%;
	}
	.results-heading {
		display: flex;
		gap: 1rem;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem 1.5rem 0.5rem;
	}
	.results-heading h2 {
		font-size: 1.35rem;
		margin: 0.35rem 0;
	}
	.source-badge,
	.fact-tag,
	.comment-tag,
	.cell-status {
		font-size: 0.72rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid #35594b;
		color: #8de4ba;
	}
	.recorded,
	.comment-tag {
		color: #efc584;
		border-color: #72633f;
	}
	.intro {
		padding: 0 1.5rem;
		color: #99aaa0;
		font-size: 0.85rem;
	}
	.notice {
		padding: 0.8rem 1rem;
		margin: 1rem 0;
		background: #233028;
		border-left: 3px solid #719781;
		font-size: 0.85rem;
	}
	.analytical-results > .notice {
		margin: 1rem 1.5rem;
	}
	.error {
		border-color: #ef8295;
		color: #efb3bf;
	}
	.coverage {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		padding: 1rem 1.5rem;
	}
	.coverage span {
		display: block;
		font-size: 0.75rem;
		color: #97aa9c;
	}
	.coverage strong {
		display: block;
		font-size: 1.4rem;
		margin-top: 0.3rem;
	}
	.result-tabs {
		display: flex;
		overflow-x: auto;
		gap: 0.3rem;
		padding: 0.5rem 1.5rem;
		border-bottom: 1px solid #344037;
	}
	.result-tabs button {
		white-space: nowrap;
		padding: 0.6rem 0.8rem;
		font-size: 0.8rem;
		color: #a7b9aa;
	}
	.result-tabs button.active {
		background: #2b4334;
		color: #baf4ce;
		border-radius: 4px;
	}
	.result-content {
		padding: 1.5rem;
		min-width: 0;
	}
	.finding {
		padding: 1rem 0;
		border-bottom: 1px solid #344037;
	}
	.finding p {
		font-size: 0.9rem;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	.commentary {
		border-left: 2px solid #72633f;
		padding-left: 1rem;
	}
	.table-scroll {
		overflow-x: auto;
		max-width: 100%;
		margin: 1rem 0;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.8rem;
	}
	td,
	th {
		padding: 0.7rem 0.8rem;
		text-align: right;
		border-bottom: 1px solid #344037;
		white-space: nowrap;
	}
	th {
		color: #a2b3a6;
		font-weight: 500;
	}
	td:last-child,
	th:last-child {
		text-align: left;
	}
	.reasons {
		white-space: normal;
		min-width: 190px;
		max-width: 340px;
		overflow-wrap: anywhere;
	}
	.cell-status {
		color: #b5c1b7;
		border-color: #566258;
	}
	.cell-status.accepted {
		color: #8de4ba;
		border-color: #35594b;
	}
	.cell-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
	}
	.cell-heading label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}
	.sample-link {
		display: block;
		color: #99d6ac;
		text-decoration: underline;
		white-space: nowrap;
		margin: 0.25rem 0;
	}
	.result-limitations {
		margin-top: 1.5rem;
		font-size: 0.85rem;
	}
	.result-limitations li {
		margin: 0.5rem 0;
		line-height: 1.5;
	}
	.trace-entry {
		padding: 0.8rem 0;
	}
	.trace-entry pre {
		font-size: 0.75rem;
		max-height: 24rem;
		overflow: auto;
		padding: 1rem;
		background: #16201a;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.trace-entry h4 {
		font-size: 0.8rem;
		margin-top: 1rem;
	}
	h3 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}
	@media (max-width: 700px) {
		.coverage {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.results-heading,
		.cell-heading {
			align-items: flex-start;
			flex-direction: column;
		}
		.result-content {
			padding: 1rem;
		}
		.result-tabs {
			padding: 0.5rem;
		}
		.source-badge {
			font-size: 0.65rem;
		}
	}
</style>
