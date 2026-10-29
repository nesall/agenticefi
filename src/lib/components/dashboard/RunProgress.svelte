<script lang="ts">
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import { investigationStatus } from './investigationStatus';
	import Bot from '@lucide/svelte/icons/bot';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import FileSearch from '@lucide/svelte/icons/file-search';
	let { job, onTrace }: { job: InvestigationJob; onTrace: (evidenceId?: string) => void } =
		$props();
	const completed = $derived(job.result?.trace ?? job.progress?.completed ?? []);
</script>

<section
	class="flex flex-wrap items-center justify-between gap-4 rounded-container border border-surface-200-800 bg-surface-100-900 px-4 py-3 text-sm"
	aria-label="Investigation execution"
	aria-live="polite"
	aria-busy={job.state === 'running'}
>
	<div class="min-w-0">
		<div class="flex items-center gap-2 font-medium">
			{#if job.state === 'running'}<LoaderCircle
					size={16}
					strokeWidth={2}
					class="shrink-0 text-primary-600-400 motion-safe:animate-spin"
					aria-hidden="true"
				/>{:else if job.error}<TriangleAlert
					size={16}
					strokeWidth={2}
					class="shrink-0 text-warning-700-300"
					aria-hidden="true"
				/>{:else}<Bot
					size={16}
					strokeWidth={2}
					class="shrink-0 text-primary-600-400"
					aria-hidden="true"
				/>{/if}{job.source === 'recorded'
				? 'Recorded Muse Spark demonstration'
				: 'Live Muse Spark'}{job.mode === 'legacy' ? ' · Legacy telemetry' : ''} · {job.state ===
			'running'
				? job.source === 'recorded'
					? 'loading historical result'
					: (job.progress?.phase.replaceAll('-', ' ') ?? 'running')
				: investigationStatus(job)}
		</div>
		<p class="mt-1 text-xs break-words text-surface-500">
			{job.logName ?? 'Run identity unavailable'}{job.progress?.tool
				? ` · ${job.progress.tool.replaceAll('_', ' ')}`
				: ''} · {completed.length} completed calls
		</p>
		{#if job.error}<p class="mt-2 break-words text-error-700-300" role="alert">{job.error}</p>{/if}
		<p class="mt-2 text-xs break-all text-surface-500">
			Job ID: {job.id}{#if job.termination}
				· {job.termination.code} · model turn {job.termination.modelTurn}{#if job.termination.tool}
					· {job.termination.tool}{/if}{/if}
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		{#each completed as entry (entry.evidenceId)}<button
				class="btn preset-tonal-surface text-xs"
				onclick={() => onTrace(entry.evidenceId)}
				>{#if entry.result.ok}<CircleCheck
						size={16}
						strokeWidth={2}
						class="shrink-0"
						aria-hidden="true"
					/>{:else}<TriangleAlert
						size={16}
						strokeWidth={2}
						class="shrink-0"
						aria-hidden="true"
					/>{/if}{entry.tool.replaceAll('_', ' ')}</button
			>{/each}<button class="btn preset-outlined-surface-500 text-xs" onclick={() => onTrace()}
			><FileSearch size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />Inspect trace ↗</button
		>
	</div>
</section>
