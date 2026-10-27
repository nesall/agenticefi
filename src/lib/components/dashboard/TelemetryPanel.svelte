<script lang="ts">
	import type { SessionSummary, TelemetryResponse } from '../../shared/types/dashboard';
	import type { ChannelSlot } from '../../shared/types/channelMapping';
	import { channelLabels, number, statusColors, statusLabels } from './presentation';
	import TelemetryChart from './TelemetryChart.svelte';
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
	let cursor = $state<number | null>(null);
	let start = $state(0),
		end = $state(0);
	$effect(() => {
		start = data?.startSec ?? session.startSec;
		end = data?.endSec ?? session.endSec;
		cursor = null;
	});
	const options: ChannelSlot[] = ['rpm', 'load', 'afr', 'tps', 'clt', 'tpsDot', 'mapDot', 'pw'];
	function toggle(slot: ChannelSlot) {
		if (selected.includes(slot)) {
			if (selected.length > 1) onChannels(selected.filter((s) => s !== slot));
		} else if (selected.length < 6) onChannels([...selected, slot]);
	}
</script>

<section class="panel telemetry-panel" aria-busy={loading}>
	<div class="panel-heading">
		<div>
			<div class="eyebrow">01 / OBSERVE</div>
			<h2>Telemetry timeline</h2>
		</div>
		<span class="pill">{data?.pointCount.toLocaleString() ?? '—'} samples</span>
	</div>
	<div class="channel-picker" aria-label="Selected telemetry channels">
		{#each options as slot (slot)}{@const resolution = session.mappings.find(
				(r) => r.slot === slot
			)}<label
				class:checked={selected.includes(slot)}
				class:unavailable={resolution?.status !== 'resolved'}
				><input
					type="checkbox"
					checked={selected.includes(slot)}
					disabled={resolution?.status !== 'resolved' ||
						(!selected.includes(slot) && selected.length >= 6)}
					onchange={() => toggle(slot)}
				/>{channelLabels[slot]}{#if resolution?.status !== 'resolved'}<span>unavailable</span
					>{/if}</label
			>{/each}
	</div>
	<form
		class="window-controls"
		onsubmit={(event) => {
			event.preventDefault();
			onWindow(start, end);
		}}
	>
		<span class="muted">Window</span><label
			><span class="sr-only">Window start in seconds</span><input
				class="input"
				type="number"
				step="any"
				min={session.startSec}
				max={session.endSec}
				bind:value={start}
				required
			/></label
		><span class="muted">to</span><label
			><span class="sr-only">Window end in seconds</span><input
				class="input"
				type="number"
				step="any"
				min={session.startSec}
				max={session.endSec}
				bind:value={end}
				required
			/></label
		><span class="muted">s</span><button
			class="btn preset-outlined-surface-500 btn-sm"
			disabled={loading}>Apply</button
		><button
			class="text-button"
			type="button"
			onclick={() => onWindow(session.startSec, session.endSec)}
			disabled={loading}>Reset</button
		>
	</form>
	{#if data}
		<div class="charts" class:pending={loading}>
			{#each data.slots as slot, index (slot)}<TelemetryChart
					{data}
					{index}
					{cursor}
					onCursor={(time) => (cursor = time)}
					{onSelect}
					{onWindow}
				/>{/each}
		</div>
		<div class="time-axis">
			<span>{number(data.startSec)} s</span><span
				>{cursor === null
					? 'Drag a chart to select a window · click to inspect'
					: `${number(cursor, 3)} s`}</span
			><span>{number(data.endSec)} s</span>
		</div>
		<div class="screening-strip">
			<span class="eyebrow">SCREENING</span><svg
				viewBox="0 0 1000 10"
				preserveAspectRatio="none"
				role="img"
				aria-label="Sample screening status across the selected time window"
				>{#each data.segments as segment (segment[0].rowIndex)}{#each segment as point, i (point.rowIndex)}<line
							x1={((point.timeSec - data.startSec) / (data.endSec - data.startSec || 1)) * 1000}
							x2={(((segment[i + 1]?.timeSec ?? point.timeSec) - data.startSec) /
								(data.endSec - data.startSec || 1)) *
								1000 +
								1}
							y1="5"
							y2="5"
							stroke={statusColors[point.status]}
							stroke-width="10"
						/>{/each}{/each}</svg
			>
		</div>
		<div class="status-legend">
			{#each Object.entries(statusLabels) as [status, label] (status)}<span
					><i style:background={statusColors[status as keyof typeof statusColors]}></i>{label}</span
				>{/each}
		</div>
	{:else}<div class="empty-small">Loading the selected measurements…</div>{/if}
</section>
