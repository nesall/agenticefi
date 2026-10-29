<script lang="ts">
	import { untrack } from 'svelte';
	import type { DashboardVeCell } from '../../shared/types/analyticalDashboard';
	import { veGrid, focusedVeGrid, type VeAxes, type GridCoordinate } from './workspace';
	import { number } from './presentation';
	import { veCorrectionLabel, evaluatedUnchanged, veCellExplanation } from './veCellDisplay';
	let {
		cells,
		axes,
		omittedCells = 0,
		initialView = 'focused',
		onCell
	}: {
		cells: DashboardVeCell[];
		axes?: VeAxes;
		omittedCells?: number;
		initialView?: 'focused' | 'full';
		onCell: (cell: GridCoordinate) => void;
	} = $props();
	let view = $state<'focused' | 'full'>(untrack(() => initialView));
	const focused = $derived(focusedVeGrid(cells, axes));
	const grid = $derived(view === 'focused' ? focused : veGrid(cells, axes));
	function cellTitle(cell: DashboardVeCell | null) {
		return cell
			? `Original VE ${number(cell.originalVe, 3)}; proposed VE ${number(cell.proposedVe, 3)}; ${cell.status}. ${veCellExplanation(cell)} ${cell.reasons.join(', ')}${cell.atBound ? '; at bound' : ''}`
			: 'This cell was not retained in the recording';
	}
</script>

<section
	id="ve-candidate-grid"
	class="min-w-0 scroll-mt-40 space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 md:p-6"
	aria-label="Advisory VE delta heatmap"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-lg font-semibold">VE candidate · cell deltas</h2>
			<p class="mt-1 text-sm text-surface-600-400">
				Unsupported and suppressed cells remain unchanged. A zero-correction outcome is valid.
			</p>
		</div>
		<span class="badge preset-tonal-warning">Advisory only</span>
	</div>
	<div class="flex flex-wrap gap-4 text-xs">
		<span class="badge preset-tonal-warning">+ Fuel added</span><span
			class="badge preset-tonal-primary">− Fuel reduced</span
		><span>Suppressed · unchanged</span><span>— Unsupported</span><span>? Unavailable evidence</span
		>
		{#if cells.some(evaluatedUnchanged)}<span>0% Evaluated, unchanged.</span>{/if}
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<div
			class="inline-flex gap-1 rounded-base bg-surface-200-800 p-1"
			role="group"
			aria-label="VE grid view"
		>
			{#each ['focused', 'full'] as value (value)}<button
					class="btn text-xs {view === value
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					aria-pressed={view === value}
					onclick={() => (view = value as 'focused' | 'full')}
					>{value === 'focused' ? 'Focused' : 'Full'}</button
				>{/each}
		</div>
		{#if view === 'focused'}<p class="text-xs text-surface-500">
				{focused.hidden} cells hidden. Accepted nonzero proposals plus one neighboring row and column.
			</p>{/if}
	</div>
	{#if grid.x.length && grid.y.length}
		<div
			class="max-w-full overflow-x-auto rounded-base border border-surface-200-800"
			role="region"
			aria-label="Scrollable VE calibration grid"
		>
			<table
				class="w-full table-fixed border-collapse text-center text-xs"
				style:min-width={`${grid.x.length * 48 + 80}px`}
			>
				<caption class="sr-only"
					>Actual calibration coordinates. MAP kPa descends vertically; RPM increases horizontally.
					Select a cell to inspect its evidence.</caption
				>
				<thead class="bg-surface-200-800"
					><tr
						><th scope="col" class="w-20 p-3 text-left">MAP / RPM</th
						>{#each grid.x as x (x.index)}<th scope="col" class="p-2 font-mono font-medium"
								>{number(x.value, 0)}</th
							>{/each}</tr
					></thead
				>
				<tbody
					>{#each grid.rows as row, index (grid.y[index].index)}<tr
							><th
								scope="row"
								class="border-t border-surface-200-800 bg-surface-200-800 p-2 font-mono"
								>{number(grid.y[index].value)} <span class="sr-only">kPa</span></th
							>{#each row as point (point.rpmIndex)}{@const cell = point.cell}<td
									class="border-t border-l border-surface-200-800 p-0.5"
									><button
										class="relative min-h-8 w-full rounded-sm px-1 py-2 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-500 {cell?.status ===
										'accepted'
											? evaluatedUnchanged(cell)
												? 'bg-surface-200-800 text-surface-700-300'
												: cell.finalCorrectionPct > 0
													? 'preset-tonal-warning'
													: 'preset-tonal-primary'
											: cell?.status === 'suppressed'
												? 'bg-surface-200-800 text-surface-700-300'
												: 'text-surface-500 hover:bg-surface-200-800'}"
										aria-label={`RPM ${number(point.rpm, 0)}, MAP ${number(point.mapKpa)} kPa: ${cell?.status ?? 'unavailable'}${cell?.status === 'accepted' ? `, ${number(cell.finalCorrectionPct, 3)} percent` : ''}${cell?.atBound ? ', at bound' : ''}`}
										title={cellTitle(cell)}
										onclick={() => onCell(point)}
										>{#if cell?.status === 'accepted' || cell?.status === 'suppressed'}{veCorrectionLabel(
												cell.finalCorrectionPct
											)}{:else if cell?.status === 'unsupported'}<span class="opacity-40">—</span
											>{:else}?{/if}{#if cell?.atBound}<span
												class="absolute top-0 right-0 size-1.5 rounded-full bg-warning-500"
												aria-hidden="true"
											></span>{/if}</button
									></td
								>{/each}</tr
						>{/each}</tbody
				>
			</table>
		</div>
	{:else}<div class="rounded-base bg-surface-200-800 p-4 text-sm">
			<p>
				{cells.length
					? 'No accepted nonzero proposals are available. No correction is a valid outcome.'
					: 'No candidate cell evidence yet. Missing values are unavailable, not inferred corrections.'}
			</p>
			<button class="mt-2 btn preset-tonal-surface text-xs" onclick={() => (view = 'full')}
				>View full grid</button
			>
		</div>{/if}
	{#if omittedCells}<p class="text-sm text-surface-600-400">
			{omittedCells} cell decisions were not retained in this recording. Missing cells are unavailable,
			not unsupported.{!axes ? ' Only retained axis coordinates can be displayed.' : ''}
		</p>{/if}
</section>
