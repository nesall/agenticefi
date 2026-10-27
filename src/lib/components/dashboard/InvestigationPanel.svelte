<script lang="ts">
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import type { JsonValue } from '../../shared/types/investigation';
	import { number } from './presentation';
	let {
		available,
		job,
		starting,
		startSec,
		endSec,
		onRun,
		onWindow,
		onSelect
	}: {
		available: boolean;
		job: InvestigationJob | null;
		starting: boolean;
		startSec: number;
		endSec: number;
		onRun: (goal: string) => void;
		onWindow: (start: number, end: number) => void;
		onSelect: (row: number) => void;
	} = $props();
	let goal = $state(
		'Investigate data quality and sample eligibility in the selected window. Identify unsuitable evidence and explain the limitations. Do not recommend tuning changes.'
	);
	let selectedEvidence = $state<string | null>(null);
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
	<label class="goal-label" for="investigation-goal">Investigation goal</label><textarea
		id="investigation-goal"
		class="textarea"
		rows="4"
		maxlength="3000"
		bind:value={goal}
		disabled={running}></textarea>
	<div class="run-window">
		Selected window <strong>{number(startSec)}–{number(endSec)} s</strong>
	</div>
	<button
		class="btn w-full preset-filled-primary-500"
		disabled={!available || running || !goal.trim()}
		onclick={() => onRun(goal)}
		>{running ? 'Investigating…' : 'Run investigation'}<span aria-hidden="true"
			>{running ? '◌' : '↗'}</span
		></button
	>
	{#if !available}<p class="configuration-note">
			Muse Spark is not configured on this server. Telemetry and eligibility inspection are
			available.
		</p>{/if}
	{#if running}<div class="run-progress" role="status">
			<span class="live-dot"></span>
			<div>
				<strong>Following the evidence</strong>
				<p>
					Investigating {number(job?.startSec ?? startSec)}–{number(job?.endSec ?? endSec)} s. The completed
					trace will appear here.
				</p>
			</div>
		</div>{/if}
	{#if job?.state === 'finished'}
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
	{:else if !running}<div class="trace-placeholder">
			<div class="trace-placeholder-icon" aria-hidden="true">≋</div>
			<h3>The next question is yours.</h3>
			<p>Select a time window and let Muse Spark inspect the evidence through analytical tools.</p>
			<span>Server-side tools · evidence-linked findings</span>
		</div>{/if}
</section>
