<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { EligibilityPage, SessionSummary } from '../../shared/types/dashboard';
	import { number, statusColors, statusLabels } from './presentation';
	let {
		session,
		page,
		onInspect
	}: { session: SessionSummary; page: EligibilityPage | null; onInspect: () => void } = $props();
</script>

<section
	class="space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 md:p-6"
	aria-label="Screening health summary"
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-lg font-semibold">Screening health · chart window</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Passing the current screening profile is a heuristic filter, not an engine tuning
				validation.
			</p>
		</div>
		<button class="btn preset-outlined-surface-500 text-sm" onclick={onInspect}
			>Inspect samples ↗</button
		>
	</div>
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each Object.entries(statusLabels) as [status, label] (status)}<div
				class="rounded-base bg-surface-200-800 p-3"
			>
				<span class="flex items-center gap-2 text-xs text-surface-600-400"
					><i
						class="size-2 rounded-full"
						style:background={statusColors[status as keyof typeof statusColors]}
					></i>{label}</span
				><strong class="mt-2 block font-mono text-xl"
					>{number(page?.summary.statuses[status as keyof typeof statusLabels], 0)}</strong
				>
			</div>{/each}
	</div>
	<Accordion
		><Accordion.Item value="profile"
			><Accordion.ItemTrigger class="flex w-full justify-between py-2 text-sm font-medium"
				>V1 screening profile · initial engineering defaults <span>+</span></Accordion.ItemTrigger
			><Accordion.ItemContent
				><p class="mb-3 text-sm text-surface-500">
					These configurable thresholds require engine-specific validation. Analytical V2, when
					selected, does not change this V1 chart overlay.
				</p>
				<dl class="grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
					{#each Object.entries(session.profile) as [key, value] (key)}<div
							class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-xs"
						>
							<dt class="min-w-0 text-right break-words text-surface-500">{key}</dt>
							<dd class="font-mono">
								{value === null ? 'Disabled' : typeof value === 'number' ? number(value, 3) : value}
							</dd>
						</div>{/each}
				</dl></Accordion.ItemContent
			></Accordion.Item
		></Accordion
	>
</section>
