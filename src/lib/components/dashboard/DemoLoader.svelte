<script lang="ts">
	import type { SessionSummary } from '../../shared/types/dashboard';
	import type { DemoId } from '../../shared/types/analyticalDashboard';
	let {
		session,
		loading,
		onload,
		selectedId = 'august8',
		onSelect = () => {},
		disabled = false,
		datasets = [{ id: 'april', label: 'April 12', available: true }]
	}: {
		session: SessionSummary | null;
		loading: boolean;
		onload: (id: DemoId) => void;
		selectedId?: DemoId;
		onSelect?: (id: DemoId) => void;
		disabled?: boolean;
		datasets?: { id: DemoId; label: string; available: boolean }[];
	} = $props();
</script>

<div class="flex min-w-0 flex-wrap items-center gap-2" aria-busy={loading}>
	<label class="sr-only" for="demo-dataset">Curated dataset</label>
	<select
		id="demo-dataset"
		class="select max-w-64 min-w-0 flex-1 bg-surface-100-900 text-sm"
		value={selectedId}
		onchange={(event) => onSelect(event.currentTarget.value as DemoId)}
		disabled={loading || disabled}
	>
		{#each datasets as dataset (dataset.id)}<option value={dataset.id} disabled={!dataset.available}
				>{dataset.label}{dataset.available ? '' : ' | unavailable'}</option
			>{/each}
	</select>
	<button
		class="btn preset-tonal-primary text-sm"
		onclick={() => onload(selectedId)}
		disabled={loading || disabled || !datasets.some((d) => d.id === selectedId && d.available)}
		>{loading
			? 'Loading...'
			: session?.demoId === selectedId
				? 'Reload'
				: 'Load selected demo'}</button
	>
	{#if session && session.demoId !== selectedId}<span
			class="w-full text-xs text-warning-700-300"
			role="status">Selection not loaded. {session.logName} is still active.</span
		>{/if}
</div>
