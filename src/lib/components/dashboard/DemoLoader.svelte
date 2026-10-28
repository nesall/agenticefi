<script lang="ts">
	import type { SessionSummary } from '../../shared/types/dashboard';
	import type { DemoId } from '../../shared/types/analyticalDashboard';
	let {
		session,
		loading,
		onload,
		selectedId = 'april',
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

<section class="source-card">
	<div class="eyebrow">DATA SOURCE <span class="tiny-label">DEMO</span></div>
	<h2>RX-7 drive log</h2>
	<p class="muted">A real drive. Matched calibration. Traceable evidence.</p>
	<label class="goal-label" for="demo-dataset">Curated dataset</label>
	<select
		id="demo-dataset"
		class="select w-full"
		value={selectedId}
		onchange={(event) => onSelect(event.currentTarget.value as DemoId)}
		disabled={loading || disabled}
	>
		{#each datasets as dataset (dataset.id)}<option value={dataset.id} disabled={!dataset.available}
				>{dataset.label}{dataset.available ? '' : ' · unavailable'}</option
			>{/each}
	</select>
	<button
		class="btn w-full preset-filled-primary-500"
		onclick={() => onload(selectedId)}
		disabled={loading || disabled}
	>
		{loading
			? 'Loading telemetry…'
			: session?.demoId === selectedId
				? 'Reload loaded demo'
				: 'Load selected demo'}
		<span aria-hidden="true">↗</span>
	</button>
	{#if session && session.demoId !== selectedId}<p class="configuration-note" role="status">
			Selection not loaded. {session.logName} is still active. Click Load selected demo before investigating.
		</p>{/if}
	{#if session}
		<div class="source-meta">
			<span class="live-dot"></span> Loaded · {session.rowCount.toLocaleString()} samples
		</div>
		<dl class="compact-meta">
			<div>
				<dt>Log file</dt>
				<dd class="file-name">{session.logName}</dd>
			</div>
			<div>
				<dt>Calibration</dt>
				<dd>{session.calibrationId}</dd>
			</div>
			{#each session.calibrations as calibration (calibration.kind)}<div>
					<dt>{calibration.kind} table</dt>
					<dd>{calibration.rows} × {calibration.columns}</dd>
				</div>{/each}
		</dl>
	{:else}<div class="source-meta">3m 10s · 243 recorded channels</div>{/if}
</section>
