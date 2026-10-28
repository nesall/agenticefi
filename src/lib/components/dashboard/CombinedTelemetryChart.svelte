<script lang="ts">
	import type { TelemetryResponse } from '../../shared/types/dashboard';
	import type { ChannelSlot } from '../../shared/types/channelMapping';
	import { channelColors, channelLabels, number } from './presentation';
	import {
		channelScale,
		normalizedSegments,
		cursorValues,
		visiblePoints,
		pointerTime,
		completedGesture,
		keyboardPoint,
		normalizedValue
	} from './telemetryVisualization';
	let {
		data,
		cursor,
		hidden,
		onCursor,
		onToggle,
		onWindow,
		onSelect
	}: {
		data: TelemetryResponse;
		cursor: number | null;
		hidden: ChannelSlot[];
		onCursor: (time: number | null) => void;
		onToggle: (slot: ChannelSlot) => void;
		onWindow: (start: number, end: number) => void;
		onSelect: (row: number) => void;
	} = $props();
	let anchor = $state<number | null>(null),
		drag = $state<number | null>(null);
	const points = $derived(visiblePoints(data));
	const curves = $derived(
		data.slots.map((slot, index) => {
			const scale = channelScale(data, index);
			const resolved = data.resolutions[index]?.status === 'resolved';
			return {
				slot,
				index,
				scale,
				segments: resolved ? normalizedSegments(data, index, scale) : []
			};
		})
	);
	const readout = $derived(cursorValues(data, cursor));
	const span = $derived(data.endSec - data.startSec || 1);
	const x = (time: number) => ((time - data.startSec) / span) * 1000;
	const y = (percent: number) => 110 - percent;
	function timeAt(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return pointerTime(event.clientX, rect.left, rect.width, data.startSec, data.endSec);
	}
	function move(event: PointerEvent) {
		const time = timeAt(event);
		onCursor(time);
		if (anchor !== null) drag = time;
	}
	function down(event: PointerEvent) {
		if (event.button !== 0) return;
		anchor = timeAt(event);
		drag = anchor;
		onCursor(anchor);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function up(event: PointerEvent) {
		if (anchor === null) return;
		const end = timeAt(event),
			action = completedGesture(points, anchor, end, span);
		anchor = null;
		drag = null;
		onCursor(end);
		if (action.kind === 'window') onWindow(action.start, action.end);
		else if (action.point) onSelect(action.point.rowIndex);
	}
	function keyboard(event: KeyboardEvent) {
		const point = keyboardPoint(points, cursor, data.startSec, event.key);
		if (!point) return;
		event.preventDefault();
		onCursor(point.timeSec);
		onSelect(point.rowIndex);
	}
</script>

<div
	class="min-w-0 space-y-3 rounded-base border border-surface-200-800 bg-surface-50-950 p-3"
	data-testid="combined-telemetry"
>
	<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-600-400">
		<p id="combined-axis-note">
			Normalized Y: 0–100% of each channel's visible-window range. Physical magnitudes are not
			comparable.
		</p>
		<span
			>{readout.point
				? `Nearest row ${readout.point.rowIndex} at ${number(readout.point.timeSec, 3)} s`
				: 'Move over the chart for physical values'}</span
		>
	</div>
	<div class="flex flex-wrap gap-2" aria-label="Curve visibility and physical cursor values">
		{#each curves as curve (curve.slot)}{@const value = readout.channels[curve.index]}
			<button
				type="button"
				class="flex min-h-11 flex-wrap items-center gap-x-2 rounded-base border border-surface-200-800 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-primary-500 {hidden.includes(
					curve.slot
				)
					? 'bg-surface-200-800'
					: 'bg-surface-100-900'}"
				aria-pressed={!hidden.includes(curve.slot)}
				aria-label={`${channelLabels[curve.slot] ?? curve.slot} curve visibility`}
				title={`Click to ${hidden.includes(curve.slot) ? 'show' : 'hide'} curve only. Visible min ${number(curve.scale.min, 6)}, max ${number(curve.scale.max, 6)} ${value.unit ?? ''}. Near-flat display guard: span <= max(0.000001, 0.001 * peak magnitude).`}
				onclick={() => onToggle(curve.slot)}
			>
				<i class="size-2 rounded-full" style:background={channelColors[curve.slot]}></i>
				<span class:line-through={hidden.includes(curve.slot)}>
					{channelLabels[curve.slot] ?? curve.slot}
				</span>
				<strong class="font-mono">
					{number(value.value)}
					{value.unit ?? 'unresolved'}
				</strong>
				{#if hidden.includes(curve.slot)}
					<span class="text-surface-500"> hidden </span>
				{/if}
				{#if curve.scale.flat}
					<span class="text-surface-500">
						{curve.scale.min === curve.scale.max ? 'constant' : 'near-flat'} · 50%
					</span>
				{:else if !curve.scale.count}
					<span class="text-surface-500">unavailable</span>
				{/if}
			</button>
		{/each}
	</div>
	<div class="flex gap-2">
		<div
			class="flex w-10 shrink-0 flex-col justify-between py-4 text-right font-mono text-[10px] text-surface-500"
			aria-hidden="true"
		>
			<span>100%</span><span>50%</span><span>0%</span>
		</div>
		<button
			type="button"
			class="chart-surface block h-56 min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-primary-500 sm:h-64 [&_svg]:h-full [&_svg]:w-full"
			aria-label="Combined telemetry. Click a sample, drag to select a time window, or use arrow keys."
			aria-describedby="combined-axis-note"
			onpointermove={move}
			onpointerdown={down}
			onpointerup={up}
			onpointercancel={() => {
				anchor = null;
				drag = null;
			}}
			onkeydown={keyboard}
		>
			<svg
				viewBox="0 0 1000 120"
				preserveAspectRatio="none"
				role="img"
				aria-label="Telemetry curves normalized independently to the visible window"
			>
				{#each [10, 60, 110] as tick (tick)}<line
						x1="0"
						x2="1000"
						y1={tick}
						y2={tick}
						stroke="var(--color-surface-400)"
						stroke-opacity="0.2"
						vector-effect="non-scaling-stroke"
					/>{/each}
				{#each curves as curve (curve.slot)}{#if !hidden.includes(curve.slot)}
						{#each curve.segments as segment, i (i)}{#if segment.length === 1}<circle
									cx={x(segment[0].timeSec)}
									cy={y(segment[0].percent)}
									r="2"
									fill={channelColors[curve.slot]}
								/>{:else}<path
									d={segment
										.map(
											(p, i) =>
												`${i ? 'L' : 'M'}${x(p.timeSec).toFixed(2)},${y(p.percent).toFixed(2)}`
										)
										.join(' ')}
									fill="none"
									stroke={channelColors[curve.slot]}
									stroke-width="1.5"
									vector-effect="non-scaling-stroke"
								/>{/if}{/each}
					{/if}{/each}
				{#if anchor !== null && drag !== null}<rect
						x={x(Math.min(anchor, drag))}
						y="0"
						width={Math.abs(x(drag) - x(anchor))}
						height="120"
						fill="var(--color-primary-500)"
						fill-opacity="0.15"
					/>{/if}
				{#if cursor !== null && cursor >= data.startSec && cursor <= data.endSec}<line
						x1={x(cursor)}
						x2={x(cursor)}
						y1="0"
						y2="120"
						stroke="var(--color-surface-500)"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>
					{#each curves as curve (curve.slot)}{@const percent = normalizedValue(
							readout.channels[curve.index].value,
							curve.scale
						)}{#if percent !== null && readout.point && !hidden.includes(curve.slot)}<circle
								cx={x(readout.point.timeSec)}
								cy={y(percent)}
								r="3"
								fill={channelColors[curve.slot]}
							/>{/if}{/each}
				{/if}
			</svg>
		</button>
	</div>
	<div class="ml-12 flex justify-between font-mono text-[10px] text-surface-500">
		<span>{number(data.startSec)} s</span><span>{number((data.startSec + data.endSec) / 2)} s</span
		><span>{number(data.endSec)} s</span>
	</div>
	{#if curves.every((c) => hidden.includes(c.slot))}<p class="text-xs text-surface-500">
			All curves temporarily hidden. Use the legend to show a curve.
		</p>{:else if curves.every((c) => !c.segments.length)}<p class="text-xs text-surface-500">
			No resolved measurements in this window.
		</p>{/if}
</div>

<style>
	.chart-surface {
		touch-action: pan-y;
		cursor: crosshair;
	}
</style>
