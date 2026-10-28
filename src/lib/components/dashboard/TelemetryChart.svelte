<script lang="ts">
	import type { PlotPoint, TelemetryResponse } from '../../shared/types/dashboard';
	import { channelColors, channelLabels, number } from './presentation';
	let {
		data,
		index,
		cursor,
		onCursor,
		onSelect,
		onWindow
	}: {
		data: TelemetryResponse;
		index: number;
		cursor: number | null;
		onCursor: (time: number | null) => void;
		onSelect: (row: number) => void;
		onWindow: (start: number, end: number) => void;
	} = $props();
	let anchor = $state<number | null>(null),
		drag = $state<number | null>(null);
	const slot = $derived(data.slots[index]);
	const resolution = $derived(data.resolutions[index]);
	const points = $derived(data.segments.flat());
	const finite = $derived(
		points.map((point) => point.values[index]).filter((value): value is number => value !== null)
	);
	const range = $derived.by(() => {
		if (!finite.length) return [0, 1];
		let min = Math.min(...finite),
			max = Math.max(...finite);
		const pad = (max - min) * 0.12 || Math.abs(min) * 0.05 || 1;
		return [min - pad, max + pad];
	});
	const span = $derived(data.endSec - data.startSec || 1);
	const x = (time: number) => ((time - data.startSec) / span) * 1000;
	const y = (value: number) => 110 - ((value - range[0]) / (range[1] - range[0])) * 100;
	function path(segment: PlotPoint[]) {
		let drawing = false;
		return segment
			.map((point) => {
				const value = point.values[index];
				if (value === null) {
					drawing = false;
					return '';
				}
				const command = drawing ? 'L' : 'M';
				drawing = true;
				return `${command}${x(point.timeSec).toFixed(2)},${y(value).toFixed(2)}`;
			})
			.join(' ');
	}
	function nearest(time: number) {
		let result = points[0];
		for (const point of points)
			if (!result || Math.abs(point.timeSec - time) < Math.abs(result.timeSec - time))
				result = point;
		return result;
	}
	const active = $derived(cursor === null ? null : nearest(cursor));
	function timeAt(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return (
			data.startSec + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * span
		);
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
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function up(event: PointerEvent) {
		if (anchor === null) return;
		const end = timeAt(event),
			start = anchor;
		anchor = null;
		drag = null;
		if (Math.abs(end - start) > span * 0.008) onWindow(Math.min(start, end), Math.max(start, end));
		else {
			const point = nearest(end);
			if (point) onSelect(point.rowIndex);
		}
	}
	function keyboard(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
		event.preventDefault();
		const current = nearest(cursor ?? data.startSec);
		if (!current) return;
		const i = points.indexOf(current);
		const point =
			points[
				Math.max(
					0,
					Math.min(
						points.length - 1,
						i + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)
					)
				)
			];
		onCursor(point.timeSec);
		onSelect(point.rowIndex);
	}
</script>

<div class="min-w-0 overflow-hidden rounded-base border border-surface-200-800 bg-surface-50-950">
	<div
		class="flex items-center justify-between gap-2 px-3 pt-2 text-xs [&_i]:size-2 [&_i]:rounded-full [&_small]:text-surface-500 [&_span]:flex [&_span]:items-center [&_span]:gap-2"
	>
		<span
			><i style:background={channelColors[slot] ?? 'var(--color-primary-500)'}></i>{channelLabels[
				slot
			] ?? slot}
			<small>{resolution.status === 'resolved' ? resolution.unit : 'unresolved'}</small></span
		><strong style:color={channelColors[slot]}>{number(active?.values[index])}</strong>
	</div>
	<div class="flex gap-2 p-2">
		<div
			class="flex w-14 shrink-0 flex-col justify-between py-1 text-right font-mono text-[10px] text-surface-500"
			aria-hidden="true"
		>
			<span>{number(range[1], 1)}</span><span>{number((range[0] + range[1]) / 2, 1)}</span><span
				>{number(range[0], 1)}</span
			>
		</div>
		<button
			class="chart-surface block h-28 min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-primary-500 [&_svg]:h-full [&_svg]:w-full"
			aria-label={`${channelLabels[slot] ?? slot}. Click a sample, drag to select a time window, or use arrow keys.`}
			onpointermove={move}
			onpointerdown={down}
			onpointerup={up}
			onpointercancel={() => {
				anchor = null;
				drag = null;
			}}
			onpointerleave={() => {
				if (anchor === null) onCursor(null);
			}}
			onkeydown={keyboard}
		>
			<svg
				viewBox="0 0 1000 120"
				preserveAspectRatio="none"
				role="img"
				aria-label={`${channelLabels[slot] ?? slot} over parsed time`}
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
				{#each data.segments as segment (segment[0].rowIndex)}<path
						d={path(segment)}
						fill="none"
						stroke={channelColors[slot] ?? '#81a9f5'}
						stroke-width="1.35"
						vector-effect="non-scaling-stroke"
					/>{#if segment.length === 1 && segment[0].values[index] !== null}<circle
							cx={x(segment[0].timeSec)}
							cy={y(segment[0].values[index]!)}
							r="2"
							fill={channelColors[slot]}
						/>{/if}{/each}
				{#if anchor !== null && drag !== null}<rect
						x={x(Math.min(anchor, drag))}
						y="0"
						width={Math.abs(x(drag) - x(anchor))}
						height="120"
						fill="var(--color-primary-500)"
						fill-opacity="0.15"
					/>{/if}
				{#if cursor !== null}<line
						x1={x(cursor)}
						x2={x(cursor)}
						y1="0"
						y2="120"
						stroke="var(--color-surface-500)"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>{#if active?.values[index] != null}<circle
							cx={x(active.timeSec)}
							cy={y(active.values[index]!)}
							r="3"
							fill={channelColors[slot]}
						/>{/if}{/if}
			</svg>
		</button>
	</div>
	{#if !finite.length}<p class="p-3 text-sm text-surface-500">
			No resolved measurements in this window.
		</p>{/if}
</div>

<style>
	.chart-surface {
		touch-action: pan-y;
		cursor: crosshair;
	}
</style>
