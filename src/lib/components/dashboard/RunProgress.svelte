<script lang="ts">
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import { investigationStatus } from './investigationStatus';
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
			{#if job.state === 'running'}<span
					class="size-2 rounded-full bg-primary-500 motion-safe:animate-pulse"
				></span>{/if}{job.source === 'recorded' ? 'Recorded demonstration' : 'Live Muse Spark'} · {job.state ===
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
				>{entry.result.ok ? '✓' : '!'} {entry.tool.replaceAll('_', ' ')}</button
			>{/each}<button class="btn preset-outlined-surface-500 text-xs" onclick={() => onTrace()}
			>Inspect trace ↗</button
		>
	</div>
</section>
