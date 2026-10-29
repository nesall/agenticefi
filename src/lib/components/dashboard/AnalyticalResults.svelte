<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import VeCandidateGrid from './VeCandidateGrid.svelte';
	import type { GridCoordinate } from './workspace';
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import type { SupportingSample } from '../../shared/types/analyticalDashboard';
	import type { JsonValue } from '../../shared/types/investigation';
	import { number } from './presentation';
	import { investigationStatus } from './investigationStatus';
	import { resolve } from '$app/paths';
	import Download from '@lucide/svelte/icons/download';
	import FileSearch from '@lucide/svelte/icons/file-search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	type Section =
		'Findings' | 'AFR neighborhoods' | 'VE candidate' | 'Holdout evaluation' | 'Tool trace';
	// eslint-disable-next-line svelte/no-unused-props -- Retain the old initialSection input; the workspace now shows all main sections.
	let {
		job,
		onSample,
		onCell = () => {},
		onEvidence = () => {}
	}: {
		job: InvestigationJob;
		onSample: (sample: SupportingSample) => void;
		initialSection?: Section;
		onCell?: (cell: GridCoordinate) => void;
		onEvidence?: (evidenceId?: string) => void;
	} = $props();
	const advisoryNotice =
		'Advisory analysis only. Whole-log training and time-separated holdout. Predicted changes are conditional model predictions under proportional-fueling assumptions, not measured improvements. No ECU writes.';
	const recordedNotice = 'No live model request was made for this display.';
	const presentation = $derived(job.presentation);
	const trace = $derived(job.result?.trace ?? job.progress?.completed ?? []);
	const report = $derived(job.result?.report);
	const status = $derived(investigationStatus(job));
	function inspect(id: string) {
		onEvidence(id);
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
	class="min-w-0 space-y-5"
	aria-label="Analytical investigation results"
	aria-busy={job.state === 'running'}
>
	<header class="space-y-3">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<p class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
					AFR / VE · Advisory analysis
				</p>
				<h1 class="mt-1 text-xl font-semibold">Advisory VE results</h1>
			</div>
			<span
				class="badge {job.source === 'recorded' ? 'preset-tonal-warning' : 'preset-tonal-primary'}"
				>{job.source === 'recorded' ? 'Recorded demonstration' : 'Live Muse Spark'} · {status}</span
			>
		</div>
		<p class="text-xs text-surface-500" data-testid="analysis-log-identity">
			Analysis log: <strong>{job.logName ?? 'Identity unavailable for this older run'}</strong
			>{#if job.calibrationId}
				· Calibration: {job.calibrationId}{/if}{#if job.rowCount !== undefined}
				· {number(job.rowCount, 0)} rows{/if} · {job.profile === 'v2-experimental'
				? 'V2 experimental'
				: 'V1'}
		</p>
		<p
			class="rounded-base border-l-4 border-warning-500 bg-warning-500/10 p-4 text-sm leading-relaxed"
		>
			<TriangleAlert
				size={16}
				strokeWidth={2}
				class="mr-1 inline-block align-text-bottom"
				aria-hidden="true"
			/>{advisoryNotice}
		</p>
		{#if job.source === 'recorded'}<p class="text-sm text-warning-700-300">
				Historical result captured {job.recordedAt ?? 'at an unavailable time'}. {recordedNotice}
			</p>{/if}
		{#if job.error}<p
				class="rounded-base bg-error-500/10 p-3 text-sm text-error-700-300"
				role="alert"
			>
				{job.error}
			</p>{/if}
	</header>
	{#if presentation?.coverage}<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<div class="rounded-base border border-surface-200-800 bg-surface-100-900 p-4">
				<span class="text-xs text-surface-500">Training samples</span><strong
					class="mt-1 block font-mono text-xl"
					>{number(presentation.coverage.trainingRows, 0)}</strong
				>
			</div>
			<div class="rounded-base border border-surface-200-800 bg-surface-100-900 p-4">
				<span class="text-xs text-surface-500">Held-out samples</span><strong
					class="mt-1 block font-mono text-xl"
					>{number(presentation.coverage.holdoutRows, 0)}</strong
				>
			</div>
			<div class="rounded-base border border-surface-200-800 bg-surface-100-900 p-4">
				<span
					class="text-xs text-surface-500"
					title="Cells with enough qualifying training observations and episodes to attempt fitting"
					>Supported VE cells</span
				><strong class="mt-1 block font-mono text-xl" data-testid="supported-ve-cells"
					>{number(presentation.coverage.supportedCells, 0)} / {presentation.coverage
						.totalCells}</strong
				>
			</div>
			<div class="rounded-base border border-surface-200-800 bg-surface-100-900 p-4">
				<span class="text-xs text-surface-500">Accepted proposals</span><strong
					class="mt-1 block font-mono text-xl"
					>{presentation.cells.filter((c) => c.status === 'accepted')
						.length}{presentation.omittedCells ? ' shown' : ''}</strong
				>
			</div>
		</div>{/if}
	<VeCandidateGrid
		cells={presentation?.cells ?? []}
		axes={presentation?.veAxes}
		omittedCells={presentation?.omittedCells ?? 0}
		{onCell}
	/>
	<section
		class="space-y-2 rounded-container border border-surface-200-800 bg-surface-100-900 p-4"
		aria-label="Advisory VE data export"
	>
		<div class="flex flex-wrap items-center gap-3">
			{#if job.state === 'finished' && job.veExport?.available}
				<a
					class="btn preset-filled-primary-500"
					href={resolve('/api/investigations/[id]/ve-export?format=csv', { id: job.id })}
					download
					><Download size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />Download
					Proposed VE Table · CSV</a
				>
				<a
					class="btn preset-tonal-surface text-sm"
					href={resolve('/api/investigations/[id]/ve-export?format=json', { id: job.id })}
					download>Advisory provenance · JSON</a
				>
			{:else}<button class="btn preset-tonal-surface" disabled
					><Download size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />Download
					Proposed VE Table · CSV</button
				>{/if}
		</div>
		<p class="text-xs text-surface-500">
			Advisory data export, not a directly importable ECU/TunerStudio calibration. Not validated on
			an engine. No ECU writes.
		</p>
		{#if !job.veExport?.available}<p class="text-xs text-surface-500">
				{job.veExport?.reason ??
					'Available after a complete calibration and finalized candidate snapshot are verified.'}
			</p>{:else if job.outcome !== 'completed'}<p class="text-sm text-warning-700-300">
				Partial investigation: this candidate was finalized before interruption. {job.presentation
					?.paired
					? 'Conditional holdout predictions are available.'
					: 'Held-out evaluation is unavailable.'}
			</p>{/if}
	</section>
	<section
		class="space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 md:p-6"
		aria-label="Held-out prediction comparison"
	>
		<h2 class="text-lg font-semibold">Held-out conditional model predictions</h2>
		<p class="text-xs text-surface-500">
			Proportional fueling model · 0 ms transport delay. Baseline and finalized candidate use
			identical evaluation rows; holdout outcomes did not select fitting parameters.
		</p>
		{#if presentation?.paired}{@const paired = presentation.paired}
			<p class="text-sm">
				<strong>{number(paired.rowCount, 0)}</strong> evaluation rows · {paired.status} · {paired.failedPredictions}
				failed predictions
			</p>
			<div class="max-w-full overflow-x-auto">
				<table
					class="w-full border-collapse text-right text-sm [&_td]:border-b [&_td]:border-surface-200-800 [&_td]:p-3 [&_th]:p-3 [&_th]:font-medium"
				>
					<thead class="text-surface-500"
						><tr
							><th class="text-left">Model-based metric · AFR</th><th>Unchanged-table baseline</th
							><th>Finalized candidate</th></tr
						></thead
					><tbody
						><tr
							><th class="text-left">MAE</th><td class="font-mono"
								>{number(paired.baseline.mae, 4)}</td
							><td class="font-mono">{number(paired.candidate?.mae, 4)}</td></tr
						><tr
							><th class="text-left">RMSE</th><td class="font-mono"
								>{number(paired.baseline.rmse, 4)}</td
							><td class="font-mono">{number(paired.candidate?.rmse, 4)}</td></tr
						></tbody
					>
				</table>
			</div>
			<p class="text-sm text-surface-500">
				AFR sensor delay compensation is unimplemented at 0 ms. Unchanged or worsened metrics are
				legitimate outcomes.
			</p>{:else}<p class="text-sm text-surface-500">
				Holdout metrics are unavailable. Evaluation requires a finalized candidate and supporting
				evidence.
			</p>{/if}
	</section>
	<section
		class="space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 md:p-6"
	>
		<div class="flex flex-wrap justify-between gap-3">
			<h2 class="text-lg font-semibold">Findings & interpretation</h2>
			<button class="btn preset-outlined-surface-500 text-xs" onclick={() => onEvidence()}
				><FileSearch size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />Inspect tool
				trace ·</button
			>
		</div>
		{#if !report}<p class="text-sm text-surface-500">
				{job.state === 'running'
					? 'Muse is investigating. Completed tool calls are available in the trace.'
					: 'No validated final report. Inspect the trace for failed calls and available partial evidence.'}
			</p>{/if}
		{#each report?.findings ?? [] as finding, i (i)}<article
				class="space-y-3 rounded-base border border-success-500/30 p-4"
			>
				<span class="badge preset-tonal-success text-xs"
					>{job.source === 'recorded'
						? 'Recorded server fact'
						: 'Server-verified numerical fact'}</span
				>
				<p class="text-sm leading-relaxed wrap-break-word">{finding.statement}</p>
				<div class="flex flex-wrap gap-2">
					{#each finding.evidenceIds as id (id)}<button
							class="btn preset-tonal-surface text-xs"
							onclick={() => inspect(id)}>Inspect {id} ·</button
						>{/each}{#each samplesFor(finding.statement, finding.evidenceIds) as sample (sample.rowIndex)}<button
							class="btn preset-tonal-primary text-xs"
							onclick={() => onSample(sample)}
							>View row {sample.rowIndex} · {number(sample.timeSec, 3)} s ·</button
						>{/each}
				</div>
			</article>{/each}
		{#each report?.commentary ?? [] as comment, i (i)}<article
				class="space-y-3 rounded-base border border-warning-500/30 p-4"
			>
				<span class="badge preset-tonal-warning text-xs">Unverified model {comment.kind}</span>
				<p class="text-sm leading-relaxed wrap-break-word">{comment.text}</p>
				<div class="flex flex-wrap gap-2">
					{#each comment.evidenceIds as id (id)}<button
							class="btn preset-tonal-surface text-xs"
							onclick={() => inspect(id)}>Supporting {id} ·</button
						>{/each}
				</div>
			</article>{/each}
	</section>
	<Accordion multiple
		><Accordion.Item value="afr"
			><Accordion.ItemTrigger
				class="flex w-full justify-between rounded-base border border-surface-200-800 p-4 text-sm font-semibold"
				>AFR error by training neighborhood <span>+</span></Accordion.ItemTrigger
			><Accordion.ItemContent class="py-4">
				<p class="mb-3 text-xs text-surface-500">
					Signed error is measured AFR minus interpolated target AFR. Neighborhoods share influence
					across neighboring VE cells.
				</p>
				<div class="max-w-full overflow-x-auto">
					<table
						class="w-full border-collapse text-right text-xs [&_td]:border-b [&_td]:border-surface-200-800 [&_td]:p-3 [&_th]:p-3 [&_th]:font-medium"
					>
						<thead class="text-surface-500"
							><tr
								><th>RPM</th><th>MAP · kPa</th><th>Samples</th><th>Mean error · AFR</th><th
									>Median · AFR</th
								><th>Std dev · AFR</th><th>Supporting telemetry</th></tr
							></thead
						><tbody
							>{#each presentation?.regions ?? [] as region (`${region.rpmIndex}-${region.mapIndex}`)}<tr
									><td class="whitespace-nowrap"
										>{region.rpmBounds.map((n) => number(n, 0)).join('-')}</td
									><td class="whitespace-nowrap"
										>{region.mapBoundsKpa.map((n) => number(n)).join('-')}</td
									><td>{number(region.summary.error.count, 0)}</td><td
										>{number(region.summary.error.mean, 3)}</td
									><td>{number(region.summary.error.median, 3)}</td><td
										>{number(region.summary.error.populationStdDev, 3)}</td
									><td
										>{#each region.samples as sample (sample.rowIndex)}<button
												class="my-0.5 btn preset-tonal-primary text-xs"
												onclick={() => onSample(sample)}
												>Row {sample.rowIndex} · {number(sample.timeSec, 3)} s ·</button
											>{:else}<span class="text-surface-500">Not retained in recording</span
											>{/each}</td
									></tr
								>{:else}<tr
									><td colspan="7" class="p-4 text-left text-surface-500"
										>AFR region evidence is unavailable. The agent may not have completed analysis.</td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>
				{#if presentation?.omittedRegions}<p class="mt-3 text-xs text-surface-500">
						{presentation.omittedRegions} additional regions were not retained in this recording.
					</p>{/if}
			</Accordion.ItemContent></Accordion.Item
		><Accordion.Item value="limitations"
			><Accordion.ItemTrigger
				class="mt-3 flex w-full justify-between rounded-base border border-surface-200-800 p-4 text-sm font-semibold"
				>Limitations and assumptions <span>+</span></Accordion.ItemTrigger
			><Accordion.ItemContent
				><ul class="list-inside list-disc space-y-2 p-4 text-sm text-surface-600-400">
					{#each presentation?.limitations ?? report?.limitations ?? [] as limitation, i (i)}<li>
							{limitation}
						</li>{/each}
				</ul></Accordion.ItemContent
			></Accordion.Item
		></Accordion
	>
</section>
