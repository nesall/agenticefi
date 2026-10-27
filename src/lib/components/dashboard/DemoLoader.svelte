<script lang="ts">
	import type { SessionSummary } from '../../shared/types/dashboard';
	let {
		session,
		loading,
		onload
	}: { session: SessionSummary | null; loading: boolean; onload: () => void } = $props();
</script>

<section class="source-card">
	<div class="eyebrow">DATA SOURCE <span class="tiny-label">DEMO</span></div>
	<h2>RX-7 drive log</h2>
	<p class="muted">A real drive. Matched calibration. Traceable evidence.</p>
	<button class="btn w-full preset-filled-primary-500" onclick={onload} disabled={loading}>
		{loading ? 'Loading telemetry…' : session ? 'Reload demo' : 'Load demo log'}
		<span aria-hidden="true">↗</span>
	</button>
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
