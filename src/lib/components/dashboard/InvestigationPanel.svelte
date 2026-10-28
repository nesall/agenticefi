<script lang="ts">
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import type { JsonValue } from '../../shared/types/investigation';
	import type { AnalyticalProfile } from '../../shared/types/analyticalDashboard';
	import { number } from './presentation';
	let {
		available,
		job,
		starting,
		startSec,
		endSec,
		onRun,
		onWindow,
		onSelect,
		onCancel,
		recordings = [],
		pendingDemo = false,
		loadedLogName
	}: {
		available: boolean;
		job: InvestigationJob | null;
		starting: boolean;
		startSec: number;
		endSec: number;
		onRun: (
			goal: string,
			options: {
				mode: 'legacy' | 'analytical';
				profile: AnalyticalProfile;
				source: 'live' | 'recorded';
				resilient: boolean;
			}
		) => void;
		onCancel: () => void;
		recordings?: AnalyticalProfile[];
		pendingDemo?: boolean;
		loadedLogName?: string;
		onWindow: (start: number, end: number) => void;
		onSelect: (row: number) => void;
	} = $props();
	let goal = $state(
		'Investigate data quality and sample eligibility in the selected window. Identify unsuitable evidence and explain the limitations. Do not recommend tuning changes.'
	);
	let selectedEvidence = $state<string | null>(null);
	let mode = $state<'legacy' | 'analytical'>('legacy');
	let profile = $state<AnalyticalProfile>('v1');
	let source = $state<'live' | 'recorded'>('live');
	let resilient = $state(true);
	function changeMode() {
		goal =
			mode === 'analytical'
				? 'Investigate the whole log: inspect AFR error by RPM/MAP neighborhood, fit the frozen bounded VE candidate, evaluate its held-out model predictions, and explain evidence coverage and limitations. No correction and worsened predictions are valid.'
				: 'Investigate data quality and sample eligibility in the selected window. Identify unsuitable evidence and explain the limitations. Do not recommend tuning changes.';
		if (mode === 'legacy') {
			source = 'live';
			profile = 'v1';
		}
	}
	const running = $derived(starting || job?.state === 'running');
	function object(value: JsonValue): Record<string, JsonValue> | null {
		return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
	}
	function windowOf(value: JsonValue) {
		const obj = object(value);
		return typeof obj?.startSec === 'number' && typeof obj?.endSec === 'number'
			? { start: obj.startSec, end: obj.endSec }
			: null;
	}
	function rowOf(value: JsonValue) {
		const obj = object(value);
		return typeof obj?.rowIndex === 'number' ? obj.rowIndex : null;
	}
	function selectEvidence(id: string) {
		selectedEvidence = id;
		requestAnimationFrame(() =>
			document
				.getElementById(`trace-${id}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
		);
	}
</script>

<section class="panel investigation-panel">
	<div class="panel-heading">
		<div>
			<div class="eyebrow">03 / INVESTIGATE</div>
			<h2>Muse Spark</h2>
		</div>
		<span class="model-mark" aria-hidden="true">✳</span>
	</div>
	<p class="panel-description">
		An investigation you can inspect. Every finding links back to tool evidence.
	</p>
	{#if loadedLogName}<p class="configuration-note">
			Loaded log: <strong>{loadedLogName}</strong>
		</p>{/if}
	{#if pendingDemo}<p class="configuration-note" role="status">
			Load the selected demo before starting an investigation. The previous log remains active until
			loading succeeds.
		</p>{/if}
	<label class="goal-label" for="investigation-mode">Investigation mode</label>
	<select
		id="investigation-mode"
		class="select w-full"
		bind:value={mode}
		onchange={changeMode}
		disabled={running}
		><option value="legacy">Legacy · telemetry investigation</option><option value="analytical"
			>Analytical Investigation · AFR / VE</option
		></select
	>
	{#if mode === 'analytical'}
		<label class="goal-label" for="analysis-profile">Frozen eligibility profile</label>
		<select id="analysis-profile" class="select w-full" bind:value={profile} disabled={running}
			><option value="v1">V1 · unchanged defaults</option><option value="v2-experimental"
				>V2 · experimental defaults</option
			></select
		>
		<label class="goal-label" for="analysis-source">Result source</label>
		<select id="analysis-source" class="select w-full" bind:value={source} disabled={running}
			><option value="live">Live Muse Spark</option><option
				value="recorded"
				disabled={!recordings.includes(profile)}
				>Recorded demonstration{recordings.includes(profile) ? '' : ' · unavailable'}</option
			></select
		>
		<p class="configuration-note">
			Whole-log analysis. Chart windows only inspect evidence. Settings are frozen before Muse
			starts. Chart screening remains V1.
		</p>
		{#if source === 'live'}<label class="retry-choice"
				><input type="checkbox" bind:checked={resilient} disabled={running} /> Bounded retries for temporary
				API errors</label
			>{/if}
	{/if}
	<label class="goal-label" for="investigation-goal">Investigation goal</label><textarea
		id="investigation-goal"
		class="textarea"
		rows="4"
		maxlength="3000"
		bind:value={goal}
		disabled={running}></textarea>
	<div class="run-window">
		Chart window <strong>{number(startSec)}–{number(endSec)} s</strong>
	</div>
	<button
		class="btn w-full preset-filled-primary-500"
		disabled={(source === 'live' && !available) ||
			pendingDemo ||
			running ||
			!goal.trim() ||
			(source === 'recorded' && !recordings.includes(profile))}
		onclick={() => onRun(goal, { mode, profile, source, resilient })}
		>{running ? 'Investigating…' : 'Run investigation'}<span aria-hidden="true"
			>{running ? '◌' : '↗'}</span
		></button
	>
	{#if running}<button class="btn w-full preset-outlined-surface-500" onclick={onCancel}
			>Cancel investigation</button
		>{/if}
	{#if !available}<p class="configuration-note">
			Muse Spark is not configured on this server. Telemetry and eligibility inspection are
			available.
		</p>{/if}
	{#if running}<div class="run-progress" role="status">
			<span class="live-dot"></span>
			<div>
				<strong
					>{job?.source === 'recorded'
						? 'Recorded · loading historical result'
						: `Live · ${job?.progress?.phase?.replaceAll('-', ' ') ?? 'starting'}`}</strong
				>
				<p>
					Investigating {number(job?.startSec ?? startSec)}–{number(job?.endSec ?? endSec)} s. The completed
					trace updates as tools complete. {job?.progress?.tool
						? `Current tool: ${job.progress.tool.replaceAll('_', ' ')}.`
						: ''}
				</p>
			</div>
		</div>{/if}
	{#if running && job?.progress?.completed.length}<ol class="completed-tools">
			{#each job.progress.completed as entry (entry.evidenceId)}<li>
					{entry.result.ok ? '✓' : '!'}
					{entry.tool.replaceAll('_', ' ')}
				</li>{/each}
		</ol>{/if}
	{#if job?.state === 'finished' && job.mode !== 'analytical'}
		<div class="run-outcome" class:run-failed={job.result?.status !== 'completed'}>
			<span
				>{job.result?.status === 'completed'
					? 'Investigation complete'
					: 'Investigation stopped'}</span
			><strong>{job.result?.trace.length ?? 0} tool calls</strong>
		</div>
		<p class="run-window">
			Run window <strong>{number(job.startSec)}–{number(job.endSec)} s</strong>
		</p>
		{#if job.error}<p class="error-inline">{job.error}</p>{/if}
		{#if job.result?.report}<div class="findings">
				<h3>Findings</h3>
				{#each job.result.report.findings as finding, i (i)}<article>
						<div class="finding-index">{String(i + 1).padStart(2, '0')}</div>
						<p>{finding.statement}</p>
						<div class="evidence-links">
							{#each finding.evidenceIds as id, citationIndex (citationIndex)}<button
									onclick={() => selectEvidence(id)}>{id} ↙</button
								>{/each}
						</div>
					</article>{:else}<p class="muted">
						The model reported insufficient evidence for a finding.
					</p>{/each}
			</div>{/if}
		<div class="trace-heading">
			<h3>Tool trace</h3>
			<span class="muted">Request → evidence</span>
		</div>
		{#each job.result?.trace ?? [] as entry, i (entry.evidenceId)}{@const window = windowOf(
				entry.arguments
			)}
			<details
				class="trace-entry"
				id={`trace-${entry.evidenceId}`}
				open={selectedEvidence === entry.evidenceId}
			>
				<summary
					><span class="trace-number">{i + 1}</span>
					<div>
						<strong>{entry.tool.replaceAll('_', ' ')}</strong><small>{entry.evidenceId}</small>
					</div>
					<span class:trace-error={!entry.result.ok} class="trace-ok"
						>{entry.result.ok ? '✓' : '!'}</span
					></summary
				>
				<div class="trace-content">
					{#if window}<button class="text-button" onclick={() => onWindow(window.start, window.end)}
							>View {number(window.start)}–{number(window.end)} s on timeline ↗</button
						>{/if}{#if entry.result.ok}{@const output = object(
							entry.result.data
						)}{#if Array.isArray(output?.samples)}<div class="evidence-links">
								{#each output.samples.slice(0, 10) as sample, sampleIndex (sampleIndex)}{@const row =
										rowOf(sample)}{#if row !== null}<button onclick={() => onSelect(row)}
											>Row {row} ↗</button
										>{/if}{/each}
							</div>{/if}{/if}
					<h4>Arguments</h4>
					<pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
					<h4>{entry.result.ok ? 'Tool result' : 'Tool error'}</h4>
					<pre>{JSON.stringify(entry.result, null, 2)}</pre>
				</div>
			</details>{/each}
		{#if job.result?.report}<details class="limitations">
				<summary>Limitations & assumptions ({job.result.report.limitations.length})</summary>
				<ul>
					{#each job.result.report.limitations as limitation (limitation)}<li>
							{limitation}
						</li>{/each}
				</ul>
			</details>{/if}
	{:else if !running && job?.mode !== 'analytical'}<div class="trace-placeholder">
			<div class="trace-placeholder-icon" aria-hidden="true">≋</div>
			<h3>The next question is yours.</h3>
			<p>Select a time window and let Muse Spark inspect the evidence through analytical tools.</p>
			<span>Server-side tools · evidence-linked findings</span>
		</div>{/if}
</section>

<style>
	select {
		margin-bottom: 0.8rem;
	}
	.retry-choice {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.78rem;
		color: #a7b9aa;
		margin: 0.8rem 0;
	}
	.completed-tools {
		font-size: 0.8rem;
		color: #a3d9b0;
		margin: 1rem 0;
		padding-left: 1rem;
	}
	.completed-tools li {
		margin: 0.4rem 0;
	}
</style>
