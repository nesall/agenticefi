<script lang="ts">
	import type { EligibilityPage, SessionSummary } from '../../shared/types/dashboard';
	import type { SampleEligibility } from '../../shared/types/sampleEligibility';
	import { number, statusColors, statusLabels } from './presentation';
	let {
		session,
		page,
		loading,
		status,
		reason,
		includeInvalidTime,
		onFilter,
		onPage,
		onSelect,
		onLocate
	}: {
		session: SessionSummary;
		page: EligibilityPage | null;
		loading: boolean;
		status: string;
		reason: string;
		includeInvalidTime: boolean;
		onFilter: (status: string, reason: string, includeInvalid: boolean) => void;
		onPage: (offset: number) => void;
		onSelect: (row: number) => void;
		onLocate: (sample: SampleEligibility) => void;
	} = $props();
	const focused = $derived(page?.focusedSample ?? null);
</script>

<section class="space-y-4" aria-label="Sample eligibility inspector" aria-busy={loading}>
	<h3 class="text-base font-semibold">Samples and exclusion proofs</h3>
	<p class="text-xs break-words text-surface-500">{session.logName}</p>
	<div class="grid gap-2 sm:grid-cols-2">
		<label
			><span class="sr-only">Filter screening status</span><select
				class="select w-full bg-surface-50-950 text-xs"
				value={status}
				onchange={(event) => onFilter(event.currentTarget.value, reason, includeInvalidTime)}
				><option value="">All statuses</option
				>{#each Object.entries(statusLabels) as [key, label] (key)}<option value={key}
						>{label}</option
					>{/each}</select
			></label
		><label
			><span class="sr-only">Filter exclusion reason</span><select
				class="select w-full bg-surface-50-950 text-xs"
				value={reason}
				onchange={(event) => onFilter(status, event.currentTarget.value, includeInvalidTime)}
				><option value="">All reasons</option
				>{#each Object.entries(page?.summary.reasonCounts ?? {}) as [code, count] (code)}<option
						value={code}>{code.replaceAll('_', ' ')} ({count})</option
					>{/each}</select
			></label
		>
	</div>
	{#if page?.unlocatableTimeCount}<label class="flex items-center gap-2 text-xs"
			><input
				type="checkbox"
				checked={includeInvalidTime}
				onchange={(event) => onFilter(status, reason, event.currentTarget.checked)}
			/>
			Include {page.unlocatableTimeCount} rows without usable time</label
		>{/if}
	<div class="max-w-full overflow-x-auto">
		<table
			class="w-full border-collapse text-left text-xs [&_td]:border-b [&_td]:border-surface-200-800 [&_td]:p-2 [&_th]:border-b [&_th]:border-surface-200-800 [&_th]:p-2 [&_th]:font-medium [&_th]:text-surface-500"
		>
			<thead
				><tr
					><th>Row</th><th>Time (s)</th><th>Screening status</th><th>Reason</th><th
						><span class="sr-only">Inspect</span></th
					></tr
				></thead
			><tbody
				>{#each page?.samples ?? [] as sample (sample.rowIndex)}<tr
						class={focused?.rowIndex === sample.rowIndex ? 'bg-primary-500/10' : ''}
						><td class="font-mono whitespace-nowrap">{sample.rowIndex}</td><td
							class="font-mono whitespace-nowrap">{number(sample.timeSec, 3)}</td
						><td
							><span
								class="inline-flex items-center gap-1.5 text-xs [&_i]:inline-block [&_i]:size-2 [&_i]:rounded-full"
								style:color={statusColors[sample.status]}
								><i style:background={statusColors[sample.status]}></i>{statusLabels[
									sample.status
								]}</span
							></td
						><td class="max-w-56 min-w-32 break-words"
							>{sample.reasons[0]?.code.replaceAll('_', ' ').toLowerCase() ??
								'All enabled checks passed'}{#if sample.reasons.length > 1}<span
									class="text-surface-500"
								>
									+{sample.reasons.length - 1}</span
								>{/if}</td
						><td
							><button
								class="btn preset-tonal-primary text-xs"
								onclick={() => onSelect(sample.rowIndex)}
								aria-label={`Inspect sample ${sample.rowIndex}`}>Inspect ↗</button
							></td
						></tr
					>{:else}<tr
						><td colspan="5" class="p-4 text-center text-surface-500"
							>{loading ? 'Loading samples…' : 'No samples match these filters.'}</td
						></tr
					>{/each}</tbody
			>
		</table>
	</div>
	<div class="flex flex-wrap items-center justify-between gap-2 text-xs [&>div]:flex [&>div]:gap-2">
		<span class="text-surface-500"
			>{page?.total
				? `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} of ${page.total.toLocaleString()} samples`
				: '0 samples'}</span
		>
		<div>
			<button
				class="btn preset-outlined-surface-500 text-xs"
				disabled={loading || !page || page.offset === 0}
				onclick={() => page && onPage(Math.max(0, page.offset - page.limit))}>Previous</button
			><button
				class="btn preset-outlined-surface-500 text-xs"
				disabled={loading || !page || page.offset + page.limit >= page.total}
				onclick={() => page && onPage(page.offset + page.limit)}>Next</button
			>
		</div>
	</div>
	{#if focused}<div
			class="space-y-4 rounded-container border border-surface-200-800 bg-surface-50-950 p-4"
			id="sample-detail"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div>
					<span class="text-xs font-semibold tracking-wider text-surface-500 uppercase"
						>SAMPLE INSPECTOR</span
					>
					<h3>
						Row {focused.rowIndex}
						<span class="text-surface-500">/ {number(focused.timeSec, 3)} s</span>
					</h3>
				</div>
				{#if focused.timeSec !== null}<button
						class="btn preset-tonal-primary text-xs"
						onclick={() => onLocate(focused)}>Show on timeline ↗</button
					>{/if}
			</div>
			<span
				class="inline-flex items-center gap-1.5 text-xs [&_i]:inline-block [&_i]:size-2 [&_i]:rounded-full"
				style:color={statusColors[focused.status]}>{statusLabels[focused.status]}</span
			>
			{#each focused.reasons as exclusion (exclusion.code)}<div
					class="space-y-2 border-t border-surface-200-800 pt-3 text-sm"
				>
					<div class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
						{exclusion.category} / {exclusion.check}
					</div>
					<h4>{exclusion.code.replaceAll('_', ' ').toLowerCase()}</h4>
					<p>{exclusion.message}</p>
					{#each exclusion.thresholds as threshold (threshold.configKey)}<div
							class="flex flex-wrap justify-between gap-2 font-mono text-xs"
						>
							<span>{threshold.configKey}</span><strong
								>{threshold.operator} {threshold.value} {threshold.unit}</strong
							>
						</div>{/each}{#each exclusion.evidence as evidence, evidenceIndex (evidenceIndex)}<div
							class="grid gap-1 rounded-base bg-surface-200-800 p-2 text-xs"
						>
							<span>{evidence.channelName ?? evidence.slot} · row {evidence.rowIndex}</span><strong
								>{number(evidence.value, 3)} {evidence.unit ?? ''}</strong
							><small
								>{evidence.method}{evidence.previousRowIndex !== undefined
									? ` · previous row ${evidence.previousRowIndex}`
									: ''}{evidence.deltaSec !== undefined
									? ` · Δt ${number(evidence.deltaSec, 3)} s`
									: ''}</small
							>
						</div>{/each}
				</div>{:else}<p class="text-surface-500">
					All enabled checks passed. Sensor accuracy, AFR transport delay, and engine-specific
					validity still need evaluation.
				</p>{/each}
			<div class="flex flex-wrap gap-2 text-xs">
				{#each Object.entries(focused.checks) as [check, state] (check)}<span
						class="rounded-base bg-surface-200-800 px-2 py-1">{check}: {state}</span
					>{/each}
			</div>
		</div>{/if}
</section>
