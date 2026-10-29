<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { Tabs } from '@skeletonlabs/skeleton-svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
	import FileSearch from '@lucide/svelte/icons/file-search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import {
		DashboardRequestError,
		initialTelemetryWindow,
		loadWindowPair,
		permanentLoss,
		sampleQuery
	} from '#lib/components/dashboard/dashboardLoading.ts';
	import { resolve } from '$app/paths';
	import DemoLoader from '#lib/components/dashboard/DemoLoader.svelte';
	import TelemetryPanel from '#lib/components/dashboard/TelemetryPanel.svelte';
	import ScreeningSummary from '#lib/components/dashboard/ScreeningSummary.svelte';
	import InspectionDrawer from '#lib/components/dashboard/InspectionDrawer.svelte';
	import { shouldRevealResults, type GridCoordinate } from '#lib/components/dashboard/workspace.ts';
	import InvestigationPanel from '#lib/components/dashboard/InvestigationPanel.svelte';
	import AnalyticalResults from '#lib/components/dashboard/AnalyticalResults.svelte';
	import type {
		DemoId,
		AnalyticalProfile,
		SupportingSample
	} from '#lib/shared/types/analyticalDashboard.ts';
	import type {
		SessionSummary,
		TelemetryResponse,
		EligibilityPage,
		InvestigationJob
	} from '#lib/shared/types/dashboard.ts';
	import type { ChannelSlot } from '#lib/shared/types/channelMapping.ts';
	import type { SampleEligibility } from '#lib/shared/types/sampleEligibility.ts';
	import { number } from '#lib/components/dashboard/presentation.ts';
	import ThemeToggle from '#lib/components/dashboard/ThemeToggle.svelte';

	let session = $state<SessionSummary | null>(null),
		telemetry = $state<TelemetryResponse | null>(null),
		eligibility = $state<EligibilityPage | null>(null),
		job = $state<InvestigationJob | null>(null);
	let demoLoading = $state(false),
		telemetryLoading = $state(false),
		samplesLoading = $state(false),
		starting = $state(false),
		error = $state(''),
		pollError = $state(false);
	let selected = $state<ChannelSlot[]>(['rpm', 'load', 'afr', 'tps', 'clt']),
		startSec = $state(0),
		endSec = $state(0);
	let status = $state(''),
		reason = $state(''),
		includeInvalidTime = $state(false),
		focusRow = $state<number | null>(null);
	let telemetryVersion = 0,
		sampleVersion = 0,
		pollTimer: ReturnType<typeof setTimeout> | undefined;
	let destroyed = false;
	let activeTab = $state('telemetry'),
		drawerOpen = $state(false),
		drawerSection = $state('proofs');
	let selectedCell = $state<GridCoordinate | null>(null),
		selectedEvidenceId = $state<string | null>(null);
	let workspaceNavigationVersion = 0,
		runNavigationVersion = 0;
	let selectedDemo = $state<DemoId>('august8');
	const pendingDemo = $derived(!!session && session.demoId !== selectedDemo);
	let datasets = $state<{ id: DemoId; label: string; available: boolean }[]>([
		{ id: 'august8', label: 'August 8 | extended RX-7 drive', available: false },
		{ id: 'april', label: 'April 12 · 3-minute drive', available: true }
	]);
	onMount(() => {
		void request<{ datasets: typeof datasets }>('/api/demo')
			.then((data) => {
				datasets = data.datasets;
			})
			.catch(() => {});
	});
	const running = $derived(starting || job?.state === 'running');
	async function request<T>(path: string, body?: unknown): Promise<T> {
		const response = await fetch(path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const data = await response.json().catch(() => null);
		if (!response.ok)
			throw new DashboardRequestError(
				response.status,
				data?.error ?? `The request failed (HTTP ${response.status}).`
			);
		if (data === null) throw new Error('The server returned an invalid response.');
		return data as T;
	}
	const message = (cause: unknown) =>
		cause instanceof Error ? cause.message : 'The request could not be completed.';
	const currentFilters = () => ({ status, reason, includeInvalidTime, focusRow });
	function handlePermanentLoss(cause: unknown, scope: 'job' | 'session') {
		const loss = permanentLoss(cause, scope);
		if (!loss) return false;
		if (pollTimer) clearTimeout(pollTimer);
		job = null;
		starting = false;
		pollError = false;
		drawerOpen = false;
		selectedCell = null;
		selectedEvidenceId = null;
		if (loss.clearSession) {
			telemetryVersion++;
			sampleVersion++;
			session = null;
			telemetry = null;
			eligibility = null;
			telemetryLoading = false;
			samplesLoading = false;
			focusRow = null;
		}
		error = loss.message;
		return true;
	}
	async function loadSamples(offset = 0) {
		if (!session || telemetryLoading) return;
		const id = session.id,
			version = ++sampleVersion;
		const params = sampleQuery(startSec, endSec, currentFilters(), offset);
		samplesLoading = true;
		try {
			const page = await request<EligibilityPage>(`/api/sessions/${id}/eligibility?${params}`);
			if (!destroyed && version === sampleVersion && session?.id === id && !telemetryLoading)
				eligibility = page;
		} catch (cause) {
			if (
				!destroyed &&
				version === sampleVersion &&
				session?.id === id &&
				!handlePermanentLoss(cause, 'session')
			)
				error = message(cause);
		} finally {
			if (version === sampleVersion) samplesLoading = false;
		}
	}
	async function windowSelection(start: number, end: number, channels = selected) {
		if (!session) return;
		if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
			error = 'Choose a valid, ordered time window.';
			return;
		}
		const requestedStart = Math.max(session.startSec, start),
			requestedEnd = Math.min(session.endSec, end);
		if (requestedStart > requestedEnd) {
			error = 'The selected window is outside this log.';
			return;
		}
		error = '';
		const id = session.id,
			version = ++telemetryVersion;
		telemetryLoading = true;
		sampleVersion++;
		samplesLoading = true;
		const filters = currentFilters();
		try {
			await loadWindowPair(
				request,
				{
					sessionId: id,
					startSec: requestedStart,
					endSec: requestedEnd,
					slots: [...channels],
					filters
				},
				() => !destroyed && version === telemetryVersion && session?.id === id,
				(pair) => {
					sampleVersion++;
					telemetry = pair.telemetry;
					eligibility = pair.eligibility;
					startSec = pair.telemetry.startSec;
					endSec = pair.telemetry.endSec;
					selected = [...pair.telemetry.slots];
				}
			);
		} catch (cause) {
			if (
				!destroyed &&
				version === telemetryVersion &&
				session?.id === id &&
				!handlePermanentLoss(cause, 'session')
			)
				error = `${message(cause)} The last successfully loaded chart and screening window is retained.`;
		} finally {
			if (version === telemetryVersion) {
				telemetryLoading = false;
				samplesLoading = false;
				if (
					!destroyed &&
					session?.id === id &&
					JSON.stringify(filters) !== JSON.stringify(currentFilters())
				)
					void loadSamples();
			}
		}
	}
	async function loadDemo(datasetId: DemoId = selectedDemo) {
		if (demoLoading || destroyed) return;
		if (running) {
			error = 'Wait for this investigation to finish before reloading the demo.';
			return;
		}
		demoLoading = true;
		telemetryVersion++;
		sampleVersion++;
		telemetryLoading = false;
		samplesLoading = false;
		selectedDemo = datasetId;
		error = '';
		try {
			const loaded = await request<SessionSummary>('/api/demo', { datasetId });
			if (destroyed) return;
			session = loaded;
			telemetry = null;
			eligibility = null;
			job = null;
			activeTab = 'telemetry';
			drawerOpen = false;
			selectedCell = null;
			selectedEvidenceId = null;
			focusRow = null;
			status = '';
			reason = '';
			includeInvalidTime = false;
			const range = initialTelemetryWindow(session);
			await windowSelection(range.startSec, range.endSec);
		} catch (cause) {
			error = message(cause);
		} finally {
			demoLoading = false;
		}
	}
	function filter(nextStatus: string, nextReason: string, invalid: boolean) {
		status = nextStatus;
		reason = nextReason;
		includeInvalidTime = invalid;
		void loadSamples();
	}
	function selectRow(row: number) {
		drawerOpen = true;
		drawerSection = 'proofs';
		selectedCell = null;
		selectedEvidenceId = null;
		focusRow = row;
		void loadSamples(eligibility?.offset ?? 0);
	}
	function locate(sample: SampleEligibility) {
		if (sample.timeSec === null || !session) return;
		switchWorkspace('telemetry');
		drawerOpen = false;
		void windowSelection(
			Math.max(session.startSec, sample.timeSec - 5),
			Math.min(session.endSec, sample.timeSec + 5)
		);
	}
	async function poll(id: string) {
		if (destroyed) return;
		pollError = false;
		try {
			const update = await request<InvestigationJob>(`/api/investigations/${id}`);
			if (destroyed || job?.id !== id) return;
			const reveal = shouldRevealResults(
				update,
				job.state === 'running',
				runNavigationVersion,
				workspaceNavigationVersion
			);
			job = update;
			if (reveal) activeTab = 'results';
			if (update.state === 'running') pollTimer = setTimeout(() => void poll(id), 1500);
		} catch (cause) {
			if (job?.id === id) {
				if (handlePermanentLoss(cause, 'job')) return;
				error = message(cause);
				pollError = true;
			}
		}
	}
	async function investigate(
		goal: string,
		options: {
			mode: 'legacy' | 'analytical';
			profile: AnalyticalProfile;
			source: 'live' | 'recorded';
			resilient: boolean;
		}
	) {
		if (!session || running || pendingDemo || demoLoading) return;
		starting = true;
		const sessionId = session.id;
		runNavigationVersion = workspaceNavigationVersion;
		error = '';
		pollError = false;
		try {
			const update = await request<InvestigationJob>('/api/investigations', {
				sessionId,
				goal,
				startSec,
				endSec,
				...options,
				resilient: options.mode === 'analytical' && options.resilient
			});
			if (destroyed || session?.id !== sessionId) return;
			job = update;
			if (shouldRevealResults(job, true, runNavigationVersion, workspaceNavigationVersion))
				activeTab = 'results';
			if (!destroyed) void poll(job.id);
		} catch (cause) {
			if (!destroyed && session?.id === sessionId && !handlePermanentLoss(cause, 'session'))
				error = message(cause);
		} finally {
			if (!session || session.id === sessionId) starting = false;
		}
	}
	async function cancelInvestigation() {
		if (!job || !running) return;
		const id = job.id;
		if (pollTimer) clearTimeout(pollTimer);
		try {
			await request(`/api/investigations/${id}/cancel`, {});
			if (!destroyed && job?.id === id) void poll(id);
		} catch (cause) {
			if (destroyed || job?.id !== id) return;
			if (!handlePermanentLoss(cause, 'job')) {
				error = message(cause);
				pollError = true;
			}
		}
	}
	function focusEvidence(sample: SupportingSample) {
		switchWorkspace('telemetry');
		drawerOpen = false;
		focusRow = sample.rowIndex;
		if (sample.timeSec !== null && session)
			void windowSelection(
				Math.max(session.startSec, sample.timeSec - 4),
				Math.min(session.endSec, sample.timeSec + 4)
			);
		else selectRow(sample.rowIndex);
		void tick().then(() =>
			document.getElementById('telemetry')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		);
	}
	function switchWorkspace(value: string) {
		if ((value === 'telemetry' || value === 'results') && value !== activeTab) {
			workspaceNavigationVersion++;
			activeTab = value;
		}
	}
	function openTrace(id?: string) {
		selectedEvidenceId = id ?? null;
		drawerSection = 'trace';
		drawerOpen = true;
	}
	function openCell(cell: GridCoordinate) {
		selectedCell = cell;
		drawerSection = 'proofs';
		selectedEvidenceId = null;
		drawerOpen = true;
	}
	function openSamples() {
		selectedCell = null;
		drawerSection = 'proofs';
		drawerOpen = true;
	}
	onDestroy(() => {
		destroyed = true;
		if (pollTimer) clearTimeout(pollTimer);
		telemetryVersion++;
		sampleVersion++;
	});
</script>

<svelte:head
	><title>AgenticEFI · Investigation workspace</title><meta
		name="description"
		content="Inspect RX-7 telemetry, screening evidence and conditional advisory VE predictions."
	/></svelte:head
>
<div class="min-h-dvh bg-surface-50-950 text-surface-950-50">
	<header
		class="sticky top-0 z-30 border-b border-surface-200-800 bg-surface-50-950/95 backdrop-blur"
	>
		<div
			class="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6"
		>
			<a
				class="inline-flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight"
				href={resolve('/')}
				aria-label="AgenticEFI home"
				><Activity
					size={24}
					strokeWidth={2}
					class="shrink-0 text-primary-600-400"
					aria-hidden="true"
				/><span>Agentic<span class="text-primary-600-400">EFI</span></span></a
			>
			<div class="flex flex-wrap items-center gap-4">
				<DemoLoader
					{session}
					{datasets}
					selectedId={selectedDemo}
					onSelect={(id) => (selectedDemo = id)}
					disabled={running}
					loading={demoLoading}
					onload={(id) => void loadDemo(id)}
				/>
				{#if session}<dl class="hidden items-center gap-5 text-xs xl:flex">
						<div>
							<dt class="text-surface-500">Duration</dt>
							<dd class="font-mono font-semibold">
								{number(session.endSec - session.startSec, 1)} s
							</dd>
						</div>
						<div>
							<dt class="text-surface-500">Samples</dt>
							<dd class="font-mono font-semibold">{number(session.rowCount, 0)}</dd>
						</div>
						<div>
							<dt class="text-surface-500">Channels</dt>
							<dd class="font-mono font-semibold">{session.channelCount}</dd>
						</div>
						<div>
							<dt class="text-surface-500">Passes screening</dt>
							<dd class="font-mono font-semibold">
								{number(session.eligibility.statuses.eligible, 0)}
							</dd>
						</div>
					</dl>
				{/if}
				<ThemeToggle />
			</div>
		</div>
	</header>
	<main class="mx-auto w-full max-w-[1920px] space-y-4 p-4 lg:p-6">
		{#if error}<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-base border border-error-500/40 bg-error-500/10 p-3 text-sm"
				role="alert"
			>
				<span class="inline-flex items-start gap-2"
					><TriangleAlert
						size={16}
						strokeWidth={2}
						class="mt-0.5 shrink-0"
						aria-hidden="true"
					/>{error}</span
				>
				<div class="flex gap-2">
					{#if pollError && job}<button
							class="btn preset-tonal-error text-xs"
							onclick={() => job && void poll(job.id)}>Reconnect</button
						>{/if}<button
						class="btn preset-tonal-surface text-xs"
						onclick={() => (error = '')}
						aria-label="Dismiss error">Dismiss</button
					>
				</div>
			</div>{/if}
		{#if session}<p class="flex flex-wrap justify-between gap-2 text-xs text-surface-500">
				<span
					>Loaded: <strong class="text-surface-950-50">{session.logName}</strong> · {session.calibrationId}</span
				><span class="xl:hidden"
					>{number(session.rowCount, 0)} samples · {session.channelCount} channels · {number(
						session.endSec - session.startSec,
						1
					)} s</span
				>
			</p>{/if}
		{#if session}<InvestigationPanel
				available={session.museAvailable}
				{job}
				{starting}
				{startSec}
				{endSec}
				onRun={(goal, options) => void investigate(goal, options)}
				onCancel={() => void cancelInvestigation()}
				recordings={session.recordings ?? []}
				pendingDemo={pendingDemo || demoLoading}
				loadedLogName={session.logName}
				onWindow={(start, end) => void windowSelection(start, end)}
				onSelect={selectRow}
				onTrace={openTrace}
				onResults={() => {
					switchWorkspace('results');
					void tick().then(() =>
						document
							.getElementById('ve-candidate-grid')
							?.scrollIntoView({ behavior: 'smooth', block: 'start' })
					);
				}}
			/>{:else}<section
				class="space-y-2 rounded-container border border-surface-200-800 bg-surface-100-900 p-4 text-center"
				aria-label="AI investigation action bar"
			>
				<div class="flex items-center justify-center gap-2">
					<p class="text-sm font-bold">AI-Powered EFI Investigation</p>
					<p>|</p>
					<p class="font text-sm font-semibold text-primary-700-300">Powered by Meta Muse Spark</p>
				</div>
				<p class="text-sm text-surface-500">
					Load a dataset to investigate telemetry evidence and advisory fueling proposals.
				</p>
			</section>{/if}
		<Tabs value={activeTab} onValueChange={(details) => switchWorkspace(details.value)}>
			<Tabs.List
				class="mb-5 flex gap-2 border-b border-surface-200-800 pb-3"
				aria-label="Investigation workspaces"
				><Tabs.Trigger
					value="telemetry"
					class="btn preset-tonal-surface text-xs data-selected:preset-tonal sm:text-sm"
					><Activity size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />1. Telemetry &
					Screening</Tabs.Trigger
				><Tabs.Trigger
					value="results"
					class="btn preset-tonal-surface text-xs data-selected:preset-tonal sm:text-sm"
					><ChartNoAxesCombined size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />2.
					Advisory VE Results</Tabs.Trigger
				>
				<Tabs.Indicator />
			</Tabs.List>
			<Tabs.Content value="telemetry" class="min-w-0 space-y-4">
				{#if session}<div id="telemetry">
						<TelemetryPanel
							{session}
							data={telemetry}
							{selected}
							loading={telemetryLoading}
							onChannels={(channels) => void windowSelection(startSec, endSec, channels)}
							onWindow={(start, end) => void windowSelection(start, end)}
							onSelect={selectRow}
						/>
					</div>
					<ScreeningSummary {session} page={eligibility} onInspect={openSamples} />
				{:else}<section
						class="mx-auto max-w-3xl space-y-5 rounded-container border border-surface-200-800 bg-surface-100-900 p-8 md:my-12 md:p-12"
					>
						<span class="badge preset-tonal-primary">RX-7 investigation workspace</span>
						<h1 class="text-3xl font-semibold tracking-tight">
							Observe the drive.<br />Qualify the evidence.
						</h1>
						<p class="max-w-xl text-sm leading-relaxed text-surface-600-400">
							August 8 is selected by default. Load it when ready; the full log is not fetched or
							analyzed automatically. April remains available as the compact demo.
						</p>
						<button
							class="btn preset-filled-primary-500"
							disabled={demoLoading || !datasets.some((d) => d.id === selectedDemo && d.available)}
							onclick={() => void loadDemo()}
							>{demoLoading ? 'Loading telemetry...' : 'Load selected demo'}</button
						>
						<p class="text-xs text-surface-500">
							V1 screening · server-side Muse Spark tools · advisory calibration candidates
						</p>
					</section>{/if}
			</Tabs.Content>
			<Tabs.Content value="results" class="min-w-0 space-y-4">
				{#if job?.mode === 'analytical'}<AnalyticalResults
						{job}
						onSample={focusEvidence}
						onCell={openCell}
						onEvidence={openTrace}
					/>
				{:else if job}<section
						class="space-y-4 rounded-container border border-surface-200-800 bg-surface-100-900 p-6"
					>
						<h1 class="text-xl font-semibold">Legacy telemetry investigation</h1>
						<p class="text-sm text-surface-500">
							The legacy report has no VE candidate. Findings and actual tool evidence remain
							available in the inspection drawer.
						</p>
						<button
							class="btn preset-tonal-primary"
							onclick={() => {
								drawerSection = 'facts';
								drawerOpen = true;
							}}>Inspect findings</button
						><button class="btn preset-outlined-surface-500" onclick={() => openTrace()}
							><FileSearch size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />Inspect
							trace</button
						>
					</section>
				{:else}<section
						class="space-y-3 rounded-container border border-surface-200-800 bg-surface-100-900 p-8"
					>
						<h1 class="text-xl font-semibold">Advisory results will appear here</h1>
						<p class="text-sm text-surface-500">
							Load a curated dataset and run an analytical investigation. No candidate or prediction
							is generated by this view.
						</p>
					</section>{/if}
			</Tabs.Content>
		</Tabs>
		<footer class="border-t border-surface-200-800 py-4 text-xs text-surface-500">
			Advisory analysis only · No ECU writes · Whole-log fitting is independent of the chart
			inspection window
		</footer>
	</main>
	{#if session}<InspectionDrawer
			open={drawerOpen}
			section={drawerSection}
			{session}
			page={eligibility}
			loading={samplesLoading}
			{status}
			{reason}
			{includeInvalidTime}
			{job}
			{selectedCell}
			{selectedEvidenceId}
			onClose={() => (drawerOpen = false)}
			onSection={(value) => (drawerSection = value)}
			onEvidence={openTrace}
			onFilter={filter}
			onPage={(offset) => void loadSamples(offset)}
			onSelect={selectRow}
			onLocate={locate}
			onSample={focusEvidence}
			onWindow={(start, end) => {
				switchWorkspace('telemetry');
				drawerOpen = false;
				void windowSelection(start, end);
			}}
		/>{/if}
</div>
