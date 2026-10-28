<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import DemoLoader from '#lib/components/dashboard/DemoLoader.svelte';
	import TelemetryPanel from '#lib/components/dashboard/TelemetryPanel.svelte';
	import EligibilityPanel from '#lib/components/dashboard/EligibilityPanel.svelte';
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
	import './dashboard.css';

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
	let selectedDemo = $state<DemoId>('april');
	const pendingDemo = $derived(!!session && session.demoId !== selectedDemo);
	let datasets = $state<{ id: DemoId; label: string; available: boolean }[]>([
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
		const data = await response.json();
		if (!response.ok) throw new Error(data.error ?? 'The request failed.');
		return data as T;
	}
	const message = (cause: unknown) =>
		cause instanceof Error ? cause.message : 'The request could not be completed.';
	async function loadSamples(offset = 0) {
		if (!session) return;
		const id = session.id,
			version = ++sampleVersion;
		const params = new SvelteURLSearchParams({
			startSec: String(startSec),
			endSec: String(endSec),
			offset: String(offset),
			limit: '12',
			status,
			reason,
			includeInvalidTime: String(includeInvalidTime)
		});
		if (focusRow !== null) params.set('focusRow', String(focusRow));
		samplesLoading = true;
		try {
			const page = await request<EligibilityPage>(`/api/sessions/${id}/eligibility?${params}`);
			if (version === sampleVersion && session?.id === id) eligibility = page;
		} catch (cause) {
			if (version === sampleVersion) error = message(cause);
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
		startSec = Math.max(session.startSec, start);
		endSec = Math.min(session.endSec, end);
		if (startSec > endSec) {
			error = 'The selected window is outside this log.';
			return;
		}
		selected = channels;
		error = '';
		const id = session.id,
			version = ++telemetryVersion;
		telemetryLoading = true;
		void loadSamples();
		const params = new SvelteURLSearchParams({
			startSec: String(startSec),
			endSec: String(endSec),
			slots: channels.join(',')
		});
		try {
			const data = await request<TelemetryResponse>(`/api/sessions/${id}/telemetry?${params}`);
			if (version === telemetryVersion && session?.id === id) telemetry = data;
		} catch (cause) {
			if (version === telemetryVersion) error = message(cause);
		} finally {
			if (version === telemetryVersion) telemetryLoading = false;
		}
	}
	async function loadDemo(datasetId: DemoId = 'april') {
		if (demoLoading || destroyed) return;
		if (running) {
			error = 'Wait for this investigation to finish before reloading the demo.';
			return;
		}
		demoLoading = true;
		selectedDemo = datasetId;
		error = '';
		try {
			session = await request<SessionSummary>('/api/demo', { datasetId });
			telemetry = null;
			eligibility = null;
			job = null;
			focusRow = null;
			status = '';
			reason = '';
			includeInvalidTime = false;
			await windowSelection(
				session.startSec,
				session.rowCount > 8000 ? Math.min(session.endSec, session.startSec + 60) : session.endSec
			);
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
		focusRow = row;
		void loadSamples(eligibility?.offset ?? 0);
	}
	function locate(sample: SampleEligibility) {
		if (sample.timeSec === null || !session) return;
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
			job = update;
			if (update.state === 'running') pollTimer = setTimeout(() => void poll(id), 1500);
		} catch (cause) {
			if (job?.id === id) {
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
		error = '';
		pollError = false;
		try {
			job = await request<InvestigationJob>('/api/investigations', {
				sessionId: session.id,
				goal,
				startSec,
				endSec,
				...options,
				resilient: options.mode === 'analytical' && options.resilient
			});
			if (!destroyed) void poll(job.id);
		} catch (cause) {
			error = message(cause);
		} finally {
			starting = false;
		}
	}
	async function cancelInvestigation() {
		if (!job || !running) return;
		if (pollTimer) clearTimeout(pollTimer);
		try {
			await request(`/api/investigations/${job.id}/cancel`, {});
			void poll(job.id);
		} catch (cause) {
			error = message(cause);
		}
	}
	function focusEvidence(sample: SupportingSample) {
		focusRow = sample.rowIndex;
		if (sample.timeSec !== null && session)
			void windowSelection(
				Math.max(session.startSec, sample.timeSec - 4),
				Math.min(session.endSec, sample.timeSec + 4)
			);
		else selectRow(sample.rowIndex);
		document.getElementById('telemetry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	onDestroy(() => {
		destroyed = true;
		if (pollTimer) clearTimeout(pollTimer);
		telemetryVersion++;
		sampleVersion++;
	});
</script>

<svelte:head
	><title>AgenticEFI · Telemetry investigation</title><meta
		name="description"
		content="Inspect EFI telemetry, deterministic sample eligibility, and evidence-linked Muse Spark investigations."
	/></svelte:head
>

<div class="dashboard">
	<header class="app-header">
		<a class="brand" href={resolve('/')} aria-label="AgenticEFI home"
			><svg viewBox="0 0 32 32" aria-hidden="true"
				><path
					d="M2 18h6l4-11 7 20 4-13h7"
					fill="none"
					stroke="currentColor"
					stroke-width="2.3"
					stroke-linejoin="round"
				/></svg
			><strong>Agentic<span>EFI</span></strong></a
		>
		<div class="header-divider"></div>
		<span class="workspace-label">INVESTIGATION WORKSPACE</span>
		<div class="header-right">
			<span class="desktop-only">Evidence before adjustment</span><span class="header-badge"
				><i></i>{session?.museAvailable ? 'Muse Spark configured' : 'Demo workspace'}</span
			>
		</div>
	</header>
	<div class="workspace-grid">
		<aside class="sidebar">
			<div class="sidebar-title">WORKSPACE <span>01</span></div>
			<DemoLoader
				{session}
				{datasets}
				selectedId={selectedDemo}
				onSelect={(id) => (selectedDemo = id)}
				disabled={running}
				loading={demoLoading}
				onload={(id) => void loadDemo(id)}
			/>
			<nav class="workspace-nav" aria-label="Workspace sections">
				<a href="#telemetry"><span>01</span> Telemetry <span>↗</span></a><a href="#eligibility"
					><span>02</span> Sample eligibility <span>↗</span></a
				><a href="#investigation"><span>03</span> Agent investigation <span>↗</span></a>
			</nav>
			<div class="sidebar-note">
				<div class="eyebrow">BUILT TO QUESTION THE DATA</div>
				<p>A clean-looking trace is not proof of reliable evidence.</p>
				<div class="sidebar-tags">
					<span>Measured telemetry</span><span>Deterministic screening</span><span
						>Traceable findings</span
					>
				</div>
			</div>
			<footer class="sidebar-footer">AgenticEFI <span>ENGINEERING PREVIEW</span></footer>
		</aside>
		<main class="main-workspace">
			<div class="workspace-heading">
				<div>
					<div class="eyebrow">DATALOG INVESTIGATION / DEMO</div>
					<h1>Look closer.<br class="mobile-only" /> Trust the evidence.</h1>
					<p>Inspect the telemetry. Understand the exclusions. Follow the investigation.</p>
				</div>
				<span class="read-only-badge">ADVISORY ONLY</span>
			</div>
			{#if error}<div class="error-banner" role="alert">
					<span>{error}</span>{#if pollError && job}<button
							class="text-button"
							onclick={() => job && void poll(job.id)}>Reconnect</button
						>{/if}<button
						class="text-button"
						onclick={() => (error = '')}
						aria-label="Dismiss error">×</button
					>
				</div>{/if}
			{#if session}<div class="session-overview">
					<div>
						<span class="eyebrow">DURATION</span><strong
							>{number(session.endSec - session.startSec, 1)} <small>s</small></strong
						>
					</div>
					<div>
						<span class="eyebrow">RECORDED SAMPLES</span><strong
							>{session.rowCount.toLocaleString()}</strong
						>
					</div>
					<div>
						<span class="eyebrow">RECORDED CHANNELS</span><strong>{session.channelCount}</strong>
					</div>
					<div>
						<span class="eyebrow">PASSES SCREENING</span><strong class="accent"
							>{session.eligibility.statuses.eligible.toLocaleString()}
							<small>/ {session.rowCount.toLocaleString()}</small></strong
						>
					</div>
				</div>
				<div class="analysis-grid">
					<div class="analysis-main">
						<div id="telemetry">
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
						<div id="eligibility">
							<EligibilityPanel
								{session}
								page={eligibility}
								loading={samplesLoading}
								{status}
								{reason}
								{includeInvalidTime}
								onFilter={filter}
								onPage={(offset) => void loadSamples(offset)}
								onSelect={selectRow}
								onLocate={locate}
							/>
						</div>
					</div>
					<div id="investigation">
						<InvestigationPanel
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
						/>
					</div>
				</div>
				{#if job?.mode === 'analytical'}<AnalyticalResults {job} onSample={focusEvidence} />{/if}
			{:else}<section class="welcome-panel">
					<div class="welcome-grid" aria-hidden="true"></div>
					<div class="welcome-content">
						<div class="eyebrow">
							<span class="live-dot"></span> A REAL DRIVE. A BETTER QUESTION.
						</div>
						<h2>Good analysis starts<br />with knowing what<br /><em>not</em> to trust.</h2>
						<p>
							Open the RX-7 demo to explore measured telemetry, inspect sample exclusions, and give
							Muse Spark evidence to investigate.
						</p>
						<button
							class="btn preset-filled-primary-500"
							onclick={() => void loadDemo()}
							disabled={demoLoading}
							>{demoLoading ? 'Preparing demo…' : 'Explore the demo'}
							<span aria-hidden="true">↗</span></button
						><span class="welcome-footnote"
							>Real MegaSquirt data · matched VE & AFR calibration</span
						>
					</div>
					<div class="welcome-trace" aria-hidden="true">
						<svg viewBox="0 0 500 300"
							><path
								d="M0 180H70L80 160L100 170L120 150H170L180 120L210 130L240 90L260 160L280 150H330L350 190L370 180L390 210H500"
							/><path
								d="M0 210H80L100 200H150L170 220L200 170H240L270 190H310L340 140L370 160H430L450 120H500"
							/></svg
						>
						<div class="trace-caption">ANALYSIS BEGINS WITH OBSERVATION</div>
					</div>
				</section>
				<div class="empty-steps">
					<div>
						<span>01</span>
						<h3>Observe the drive</h3>
						<p>Normalized channels, explicit units, and visible time breaks.</p>
					</div>
					<div>
						<span>02</span>
						<h3>Qualify the evidence</h3>
						<p>Inspect the thresholds and reasons behind every exclusion.</p>
					</div>
					<div>
						<span>03</span>
						<h3>Follow the reasoning</h3>
						<p>Tool calls and findings you can trace back to the data.</p>
					</div>
				</div>{/if}
			<footer class="workspace-footer">
				<span>Measured data. Explicit assumptions.</span><span
					>Screening results are not validated tuning recommendations.</span
				>
			</footer>
		</main>
	</div>
</div>
