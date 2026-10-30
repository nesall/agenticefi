<script lang="ts">
	import { Popover, Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { InvestigationJob } from '../../shared/types/dashboard';
	import type { AnalyticalProfile } from '../../shared/types/analyticalDashboard';
	import { number } from './presentation';
	import RunProgress from './RunProgress.svelte';
	import Play from '@lucide/svelte/icons/play';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	// eslint-disable-next-line svelte/no-unused-props -- Preserve legacy callback inputs; trace navigation now lives in InspectionDrawer.
	let {
		available,
		job,
		starting,
		startSec,
		endSec,
		onRun,
		onCancel,
		recordings = [],
		pendingDemo = false,
		loadedLogName,
		onTrace = () => {},
		onResults = () => {}
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
		onTrace?: (evidenceId?: string) => void;
		onResults?: () => void;
		onWindow: (start: number, end: number) => void;
		onSelect: (row: number) => void;
	} = $props();
	let goal = $state(
		'Investigate the whole log: inspect AFR error by RPM/MAP neighborhood, fit the frozen bounded VE candidate, evaluate its held-out model predictions, and explain evidence coverage and limitations. No correction and worsened predictions are valid.'
	);
	let mode = $state<'legacy' | 'analytical'>('analytical');
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
	const effectiveSource = $derived(
		mode === 'analytical' && !available && recordings.includes(profile) ? 'recorded' : source
	);
</script>

<section
	class="space-y-3 rounded-container border border-primary-500/25 bg-surface-100-900 p-4 md:py-5"
	aria-label="AI investigation action bar"
>
	<div class="text-center">
		<div class="flex items-center justify-center gap-2">
			<p class="text-sm font-bold">AI-Powered EFI Investigation</p>
			<p>|</p>
			<p class="font text-sm font-semibold text-primary-700-300">Powered by Meta Muse Spark</p>
		</div>
		<p class="mt-1 text-sm text-surface-600-400">
			Investigate telemetry evidence and assess advisory fueling proposals with explicit
			limitations.
		</p>
		<p class="mt-1 text-xs text-surface-500">
			{running && job ? 'Current run' : 'Next run'} · {running && job
				? job.source === 'recorded'
					? 'Recorded Muse Spark demonstration'
					: 'Live Muse Spark'
				: effectiveSource === 'recorded'
					? 'Recorded Muse Spark demonstration'
					: 'Live Muse Spark'} · {(running && job ? job.mode : mode) === 'legacy'
				? 'Legacy telemetry investigation'
				: `Analytical investigation · ${running && job ? (job.profile === 'v2-experimental' ? 'V2 experimental' : 'V1') : profile === 'v2-experimental' ? 'V2 experimental' : 'V1'}`}
		</p>
	</div>
	<div class="flex flex-wrap items-center justify-center gap-3" aria-label="Investigation controls">
		<button
			class="btn min-h-10 w-full preset-filled-primary-500 px-8 text-lg font-bold shadow-md sm:w-auto"
			disabled={pendingDemo ||
				running ||
				!goal.trim() ||
				(effectiveSource === 'live' && !available) ||
				(effectiveSource === 'recorded' && !recordings.includes(profile))}
			onclick={() =>
				onRun(goal, {
					mode,
					profile,
					source: mode === 'legacy' ? 'live' : effectiveSource,
					resilient
				})}
		>
			{#if running}
				<LoaderCircle
					size={16}
					strokeWidth={2}
					class="shrink-0 motion-safe:animate-spin"
					aria-hidden="true"
				/>
			{:else}
				<Play size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
			{/if}
			{running
				? 'Investigating...'
				: mode === 'analytical' && effectiveSource === 'recorded'
					? 'View recorded result'
					: 'Run investigation'}
		</button>
		{#if running}
			<button
				class="btn preset-outlined-surface-500 text-sm"
				disabled={starting || !job || job.state !== 'running'}
				onclick={onCancel}
			>
				Cancel investigation
			</button>
		{/if}
		{#if !running && job?.state === 'finished'}
			<button class="btn min-h-10 preset-filled-secondary-500 font-bold" onclick={onResults}>
				<ChartNoAxesCombined size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
				<span>View Results</span>
			</button>
		{/if}
		<Popover positioning={{ placement: 'bottom-end' }}
			><Popover.Trigger class="btn preset-tonal-surface text-sm" aria-label="Advanced Configuration"
				><Settings2
					size={16}
					strokeWidth={2}
					class="shrink-0"
					aria-hidden="true"
					disabled={running || starting || !job || job.state !== 'running'}
				/>Options</Popover.Trigger
			><Popover.Positioner class="z-50!">
				><Popover.Content
					class="w-96 max-w-[calc(100vw-2rem)] space-y-4 rounded-container border border-surface-200-800 bg-surface-50-950 p-4 shadow-xl"
					><Popover.Title class="font-semibold">Investigation options</Popover.Title>
					<p class="text-xs text-surface-500">
						Loaded log: <strong>{loadedLogName ?? 'No dataset loaded'}</strong>
					</p>
					<Accordion defaultValue={['configuration']}
						><Accordion.Item value="configuration"
							><Accordion.ItemTrigger class="flex w-full justify-between py-2 text-sm font-medium"
								>Advanced Configuration <span>+</span></Accordion.ItemTrigger
							><Accordion.ItemContent class="space-y-3">
								<label class="block text-xs" for="investigation-mode">Investigation mode</label
								><select
									id="investigation-mode"
									class="select w-full bg-surface-100-900 text-sm"
									bind:value={mode}
									onchange={changeMode}
									disabled={running}
									><option value="analytical">Analytical Investigation · AFR / VE</option><option
										value="legacy">Legacy · telemetry investigation</option
									></select
								>
								{#if mode === 'analytical'}<label class="block text-xs" for="analysis-profile"
										>Frozen eligibility profile</label
									><select
										id="analysis-profile"
										class="select w-full bg-surface-100-900 text-sm"
										bind:value={profile}
										disabled={running}
										><option value="v1">V1 · unchanged defaults</option><option
											value="v2-experimental">V2 · experimental defaults</option
										></select
									>
									<label class="block text-xs" for="analysis-source">Result source</label><select
										id="analysis-source"
										class="select w-full bg-surface-100-900 text-sm"
										value={effectiveSource}
										onchange={(event) =>
											(source = event.currentTarget.value as 'live' | 'recorded')}
										disabled={running}
										><option value="live" disabled={!available}>Live Muse Spark</option><option
											value="recorded"
											disabled={!recordings.includes(profile)}>Recorded demonstration</option
										></select
									>
									<p class="text-xs text-surface-500">
										Whole-log analysis. Chart windows only inspect evidence. Settings are frozen
										before Muse starts. Chart screening remains V1.
									</p>
									<label class="flex items-center gap-2 text-xs"
										><input type="checkbox" bind:checked={resilient} disabled={running} /> Bounded retries
										for temporary API errors</label
									>{/if}
								<label class="block text-xs" for="investigation-goal">Investigation goal</label
								><textarea
									id="investigation-goal"
									class="textarea w-full bg-surface-100-900 text-sm"
									rows="4"
									maxlength="3000"
									bind:value={goal}
									disabled={running}></textarea>
								<p class="text-xs text-surface-500">
									Chart window {number(startSec)}·{number(endSec)} s. No ECU writes or automatic calibration
									application.
								</p>
							</Accordion.ItemContent></Accordion.Item
						></Accordion
					>
				</Popover.Content></Popover.Positioner
			></Popover
		>
		{#if !available}<p class="w-full text-xs text-surface-500">
				Muse Spark is not configured on this server.{recordings.includes(profile)
					? ' A labeled recorded fallback is available.'
					: ' Telemetry inspection remains available.'}
			</p>
		{/if}
		{#if running && job?.progress?.completed.length}<span class="sr-only"
				>Completed calls: {job.progress.completed
					.map((entry) => entry.tool.replaceAll('_', ' '))
					.join(', ')}</span
			>
		{/if}
	</div>
	{#if job}<RunProgress {job} {onTrace} />{:else if starting}<p
			class="text-center text-sm text-primary-700-300"
			role="status"
		>
			Starting investigation…
		</p>{/if}
</section>
