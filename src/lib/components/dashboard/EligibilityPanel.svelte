<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
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

<section class="panel eligibility-panel" aria-busy={loading}>
	<div class="panel-heading">
		<div>
			<div class="eyebrow">02 / QUALIFY</div>
			<h2>Evidence eligibility</h2>
		</div>
		<span class="pill">steady-afr-ve-v1</span>
	</div>
	<p class="panel-description">
		Every sample has a reason. Passing the current profile is a screening result, not a tuning
		guarantee.
	</p>
	<div class="eligibility-counts">
		{#each Object.entries(statusLabels) as [key, label] (key)}<button
				class:active={status === key}
				onclick={() => onFilter(status === key ? '' : key, reason, includeInvalidTime)}
				><span
					><i style:background={statusColors[key as keyof typeof statusColors]}></i>{label}</span
				><strong
					>{page ? number(page.summary.statuses[key as keyof typeof statusLabels], 0) : '?'}</strong
				></button
			>{/each}
	</div>
	<Accordion multiple class="audit-accordion">
		<Accordion.Item value="profile"
			><Accordion.ItemTrigger class="audit-trigger"
				>Applied screening profile <span aria-hidden="true">+</span></Accordion.ItemTrigger
			><Accordion.ItemContent
				><p class="muted small">
					Initial engineering defaults. These thresholds require engine-specific validation.
				</p>
				<dl class="profile-grid">
					{#each Object.entries(session.profile) as [key, value] (key)}<div>
							<dt>{key}</dt>
							<dd>{value === null ? 'Disabled' : value}</dd>
						</div>{/each}
				</dl></Accordion.ItemContent
			></Accordion.Item
		>
	</Accordion>
	<div class="sample-filters">
		<label
			><span class="sr-only">Filter screening status</span><select
				class="select"
				value={status}
				onchange={(event) => onFilter(event.currentTarget.value, reason, includeInvalidTime)}
				><option value="">All statuses</option
				>{#each Object.entries(statusLabels) as [key, label] (key)}<option value={key}
						>{label}</option
					>{/each}</select
			></label
		><label
			><span class="sr-only">Filter exclusion reason</span><select
				class="reason-select select"
				value={reason}
				onchange={(event) => onFilter(status, event.currentTarget.value, includeInvalidTime)}
				><option value="">All reasons</option
				>{#each Object.entries(page?.summary.reasonCounts ?? {}) as [code, count] (code)}<option
						value={code}>{code.replaceAll('_', ' ')} ({count})</option
					>{/each}</select
			></label
		>
	</div>
	{#if page?.unlocatableTimeCount}<label class="invalid-toggle"
			><input
				type="checkbox"
				checked={includeInvalidTime}
				onchange={(event) => onFilter(status, reason, event.currentTarget.checked)}
			/>
			Include {page.unlocatableTimeCount} rows without usable time</label
		>{/if}
	<div class="table-scroll">
		<table class="samples-table">
			<thead
				><tr
					><th>Row</th><th>Time (s)</th><th>Screening status</th><th>Reason</th><th
						><span class="sr-only">Inspect</span></th
					></tr
				></thead
			><tbody
				>{#each page?.samples ?? [] as sample (sample.rowIndex)}<tr
						class:chosen={focused?.rowIndex === sample.rowIndex}
						><td class="mono">{sample.rowIndex}</td><td class="mono">{number(sample.timeSec, 3)}</td
						><td
							><span class="sample-status" style:color={statusColors[sample.status]}
								><i style:background={statusColors[sample.status]}></i>{statusLabels[
									sample.status
								]}</span
							></td
						><td class="reason-cell"
							>{sample.reasons[0]?.code.replaceAll('_', ' ').toLowerCase() ??
								'All enabled checks passed'}{#if sample.reasons.length > 1}<span class="muted">
									+{sample.reasons.length - 1}</span
								>{/if}</td
						><td
							><button
								class="text-button"
								onclick={() => onSelect(sample.rowIndex)}
								aria-label={`Inspect sample ${sample.rowIndex}`}>Inspect ↗</button
							></td
						></tr
					>{:else}<tr
						><td colspan="5" class="empty-small"
							>{loading ? 'Loading samples…' : 'No samples match these filters.'}</td
						></tr
					>{/each}</tbody
			>
		</table>
	</div>
	<div class="pagination">
		<span class="muted"
			>{page?.total
				? `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} of ${page.total.toLocaleString()} samples`
				: '0 samples'}</span
		>
		<div>
			<button
				class="btn preset-outlined-surface-500 btn-sm"
				disabled={loading || !page || page.offset === 0}
				onclick={() => page && onPage(Math.max(0, page.offset - page.limit))}>Previous</button
			><button
				class="btn preset-outlined-surface-500 btn-sm"
				disabled={loading || !page || page.offset + page.limit >= page.total}
				onclick={() => page && onPage(page.offset + page.limit)}>Next</button
			>
		</div>
	</div>
	{#if focused}<div class="sample-detail" id="sample-detail">
			<div class="detail-heading">
				<div>
					<span class="eyebrow">SAMPLE INSPECTOR</span>
					<h3>
						Row {focused.rowIndex} <span class="muted">/ {number(focused.timeSec, 3)} s</span>
					</h3>
				</div>
				{#if focused.timeSec !== null}<button class="text-button" onclick={() => onLocate(focused)}
						>Show on timeline ↗</button
					>{/if}
			</div>
			<span class="sample-status" style:color={statusColors[focused.status]}
				>{statusLabels[focused.status]}</span
			>
			{#each focused.reasons as exclusion (exclusion.code)}<div class="exclusion">
					<div class="eyebrow">{exclusion.category} / {exclusion.check}</div>
					<h4>{exclusion.code.replaceAll('_', ' ').toLowerCase()}</h4>
					<p>{exclusion.message}</p>
					{#each exclusion.thresholds as threshold (threshold.configKey)}<div
							class="threshold-line"
						>
							<span>{threshold.configKey}</span><strong
								>{threshold.operator} {threshold.value} {threshold.unit}</strong
							>
						</div>{/each}{#each exclusion.evidence as evidence, evidenceIndex (evidenceIndex)}<div
							class="evidence-line"
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
				</div>{:else}<p class="muted">
					All enabled checks passed. Sensor accuracy, AFR transport delay, and engine-specific
					validity still need evaluation.
				</p>{/each}
			<div class="check-list">
				{#each Object.entries(focused.checks) as [check, state] (check)}<span
						class:check-pass={state === 'pass'}>{check}: {state}</span
					>{/each}
			</div>
		</div>{/if}
</section>
