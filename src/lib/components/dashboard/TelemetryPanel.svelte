<script lang="ts">
	import { untrack } from 'svelte';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import type { SessionSummary, TelemetryResponse } from '../../shared/types/dashboard';
	import type { ChannelSlot } from '../../shared/types/channelMapping';
	import { channelLabels, number, statusColors, statusLabels } from './presentation';
	import TelemetryChart from './TelemetryChart.svelte';
	import CombinedTelemetryChart from './CombinedTelemetryChart.svelte';
	import { changeChartMode, toggleCurve, type ChartView } from './telemetryVisualization';
	import { initialTelemetryWindow } from './dashboardLoading';
	let {
		session,
		data,
		selected,
		loading,
		onChannels,
		onWindow,
		onSelect
	}: {
		session: SessionSummary;
		data: TelemetryResponse | null;
		selected: ChannelSlot[];
		loading: boolean;
		onChannels: (slots: ChannelSlot[]) => void;
		onWindow: (start: number, end: number) => void;
		onSelect: (row: number) => void;
	} = $props();
	let view = $state<ChartView>({ mode: 'combined', cursor: null, hidden: [] });
	function trackCursor(time: number | null) {
		// Retain the last inspection cursor when leaving the plot to operate view controls.
		if (time !== null) view.cursor = time;
	}
	let start = $state(0),
		end = $state(0);
	$effect(() => {
		start = data?.startSec ?? session.startSec;
		end = data?.endSec ?? session.endSec;
		untrack(() => {
			view.cursor = null;
		});
	});
	const options: ChannelSlot[] = ['rpm', 'load', 'afr', 'tps', 'clt', 'tpsDot', 'mapDot', 'pw'];
	function toggle(slot: ChannelSlot) {
		if (selected.includes(slot)) {
			if (selected.length > 1) onChannels(selected.filter((s) => s !== slot));
		} else if (selected.length < 6) onChannels([...selected, slot]);
	}
</script>

<section
	class="min-w-0 space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 md:p-6"
	aria-busy={loading}
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<div class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
				01 / OBSERVE
			</div>
			<h2 class="mt-1 text-lg font-semibold">Synchronized telemetry</h2>
		</div>
		<span class="badge preset-tonal-surface text-xs">
			{data?.pointCount.toLocaleString() ?? '—'} samples
		</span>
	</div>
	<div class="flex flex-wrap items-center gap-4">
		<Popover positioning={{ placement: 'bottom-end' }}>
			<Popover.Trigger class="btn preset-outlined-surface-500 text-sm">
				Channels · {selected.length}/6
			</Popover.Trigger>
			<Popover.Positioner class="z-40">
				<Popover.Content
					class="w-80 max-w-[calc(100vw-2rem)] rounded-container border border-surface-200-800 bg-surface-50-950 p-4 shadow-xl"
				>
					<Popover.Title class="mb-3 font-semibold">Telemetry channels</Popover.Title>
					<div class="grid grid-cols-2 gap-3" aria-label="Selected telemetry channels">
						{#each options as slot (slot)}{@const resolution = session.mappings.find(
								(r) => r.slot === slot
							)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={selected.includes(slot)}
									disabled={resolution?.status !== 'resolved' ||
										(!selected.includes(slot) && selected.length >= 6)}
									onchange={(event) => {
										toggle(slot);
										event.currentTarget.checked = selected.includes(slot);
									}}
								/>
								{channelLabels[slot]}{#if resolution?.status !== 'resolved'}<span>unavailable</span>
								{/if}
							</label>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Popover>
		<form
			class="flex flex-wrap items-center gap-2 text-sm"
			onsubmit={(event) => {
				event.preventDefault();
				onWindow(start, end);
			}}
		>
			<span class="text-surface-500">Window</span><label>
				<span class="sr-only">Window start in seconds</span>
				<input
					class="input w-28 bg-surface-50-950 font-mono text-xs"
					type="number"
					step="any"
					min={session.startSec}
					max={session.endSec}
					bind:value={start}
					required
				/>
			</label>
			<span class="text-surface-500">to</span><label>
				<span class="sr-only">Window end in seconds</span>
				<input
					class="input w-28 bg-surface-50-950 font-mono text-xs"
					type="number"
					step="any"
					min={session.startSec}
					max={session.endSec}
					bind:value={end}
					required
				/>
			</label>
			<span class="text-surface-500">s</span>
			<button class="btn preset-outlined-surface-500 text-xs" disabled={loading}>Apply</button>
			<button
				class="btn preset-outlined-surface-500 text-xs"
				type="button"
				onclick={() => {
					const range = initialTelemetryWindow(session);
					onWindow(range.startSec, range.endSec);
				}}
				disabled={loading}>Reset</button
			>
		</form>
	</div>
	<div class="flex flex-wrap items-center gap-2 text-xs">
		<span class="text-surface-500">Quick range</span>
		{#each [10, 30, 60] as seconds (seconds)}
			<button
				class="btn preset-tonal-surface text-xs"
				disabled={loading}
				onclick={() =>
					onWindow(
						data?.startSec ?? session.startSec,
						Math.min(session.endSec, (data?.startSec ?? session.startSec) + seconds)
					)}
			>
				{seconds} s
			</button>
		{/each}
		<span class="text-surface-500"> Up to 8,000 samples per chart window · no downsampling </span>
	</div>
	{#if data}
		<div class="flex flex-wrap items-center gap-3">
			<div
				class="inline-flex gap-1 rounded-base border border-surface-200-800 p-1"
				role="group"
				aria-label="Telemetry visualization mode"
			>
				{#each ['combined', 'stacked'] as mode (mode)}
					<button
						type="button"
						aria-pressed={view.mode === mode}
						class="btn text-xs {view.mode === mode
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						onclick={() =>
							(view = changeChartMode(view, mode === 'combined' ? 'combined' : 'stacked'))}
					>
						{mode === 'combined' ? 'Combined' : 'Stacked'}
					</button>
				{/each}
			</div>
			<span class="text-xs text-surface-500">
				{view.mode === 'combined'
					? 'Independent normalization · click legend items to hide curves'
					: 'Independent physical Y-axes · all selected channels'}</span
			>
		</div>
		<div class="grid min-w-0 gap-2" class:opacity-60={loading}>
			{#if view.mode === 'combined'}
				<CombinedTelemetryChart
					{data}
					cursor={view.cursor}
					hidden={view.hidden}
					onCursor={trackCursor}
					onToggle={(slot) => (view.hidden = toggleCurve(view.hidden, slot))}
					{onSelect}
					{onWindow}
				/>
			{:else}
				{#each data.slots as slot, index (slot)}<TelemetryChart
						{data}
						{index}
						cursor={view.cursor}
						onCursor={trackCursor}
						{onSelect}
						{onWindow}
					/>
				{/each}
			{/if}
		</div>
		<div class="flex flex-wrap justify-between gap-2 text-xs text-surface-500">
			<span>{number(data.startSec)} s</span><span>
				{view.cursor === null
					? 'Drag a chart to select a window · click to inspect'
					: `${number(view.cursor, 3)} s`}
			</span>
			<span>{number(data.endSec)} s</span>
		</div>
		<div class="space-y-1 [&_svg]:block [&_svg]:h-3 [&_svg]:w-full">
			<span class="text-xs font-semibold tracking-wider text-surface-500 uppercase">SCREENING</span>
			<svg
				viewBox="0 0 1000 10"
				preserveAspectRatio="none"
				role="img"
				aria-label="Sample screening status across the selected time window"
			>
				{#each data.segments as segment (segment[0].rowIndex)}
					{#each segment as point, i (point.rowIndex)}<line
							x1={((point.timeSec - data.startSec) / (data.endSec - data.startSec || 1)) * 1000}
							x2={(((segment[i + 1]?.timeSec ?? point.timeSec) - data.startSec) /
								(data.endSec - data.startSec || 1)) *
								1000 +
								1}
							y1="5"
							y2="5"
							stroke={statusColors[point.status]}
							stroke-width="10"
						/>
					{/each}
				{/each}
			</svg>
		</div>
		<div
			class="flex flex-wrap gap-4 text-xs [&_i]:inline-block [&_i]:size-2 [&_i]:rounded-full [&_span]:flex [&_span]:items-center [&_span]:gap-1.5"
		>
			{#each Object.entries(statusLabels) as [status, label] (status)}
				<span>
					<i style:background={statusColors[status as keyof typeof statusColors]}> </i>
					{label}</span
				>
			{/each}
		</div>
	{:else}
		<div class="rounded-base bg-surface-200-800 p-8 text-center text-sm text-surface-500">
			Loading the selected measurements…
		</div>
	{/if}
</section>
