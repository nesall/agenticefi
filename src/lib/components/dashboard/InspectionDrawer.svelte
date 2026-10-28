<script lang="ts">
	import { Dialog, Tabs } from '@skeletonlabs/skeleton-svelte';
	import type {
		EligibilityPage,
		InvestigationJob,
		SessionSummary
	} from '../../shared/types/dashboard';
	import type { SampleEligibility } from '../../shared/types/sampleEligibility';
	import type { JsonValue } from '../../shared/types/investigation';
	import type { SupportingSample } from '../../shared/types/analyticalDashboard';
	import { neighboringSamples, type GridCoordinate } from './workspace';
	import { number } from './presentation';
	import EligibilityPanel from './EligibilityPanel.svelte';
	let {
		open,
		section,
		session,
		page,
		loading,
		status,
		reason,
		includeInvalidTime,
		job,
		selectedCell = null,
		selectedEvidenceId = null,
		onClose,
		onSection,
		onEvidence,
		onFilter,
		onPage,
		onSelect,
		onLocate,
		onSample,
		onWindow
	}: {
		open: boolean;
		section: string;
		session: SessionSummary;
		page: EligibilityPage | null;
		loading: boolean;
		status: string;
		reason: string;
		includeInvalidTime: boolean;
		job: InvestigationJob | null;
		selectedCell?: GridCoordinate | null;
		selectedEvidenceId?: string | null;
		onClose: () => void;
		onSection: (value: string) => void;
		onEvidence: (id: string) => void;
		onFilter: (status: string, reason: string, invalid: boolean) => void;
		onPage: (offset: number) => void;
		onSelect: (row: number) => void;
		onLocate: (sample: SampleEligibility) => void;
		onSample: (sample: SupportingSample) => void;
		onWindow: (start: number, end: number) => void;
	} = $props();
	const trace = $derived(job?.result?.trace ?? job?.progress?.completed ?? []);
	const samples = $derived(
		selectedCell ? neighboringSamples(job?.presentation?.regions ?? [], selectedCell) : []
	);
	function object(value: JsonValue): Record<string, JsonValue> | null {
		return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
	}
	function windowOf(value: JsonValue) {
		const obj = object(value);
		return typeof obj?.startSec === 'number' && typeof obj?.endSec === 'number'
			? { start: obj.startSec, end: obj.endSec }
			: null;
	}
	function rowsOf(value: JsonValue): number[] {
		const output = object(value);
		return Array.isArray(output?.samples)
			? output.samples.slice(0, 10).flatMap((sample) => {
					const row = object(sample)?.rowIndex;
					return typeof row === 'number' ? [row] : [];
				})
			: [];
	}
</script>

<Dialog
	{open}
	onOpenChange={(details) => {
		if (!details.open) onClose();
	}}
>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/60 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex justify-end">
		<Dialog.Content
			class="flex h-dvh w-full max-w-3xl flex-col border-l border-surface-200-800 bg-surface-50-950 text-surface-950-50 shadow-2xl"
		>
			<header
				class="flex shrink-0 items-start justify-between gap-4 border-b border-surface-200-800 p-4"
			>
				<div>
					<Dialog.Title class="text-lg font-semibold">Inspection & evidence</Dialog.Title
					><Dialog.Description class="mt-1 text-xs text-surface-500"
						>{session.logName} · {job?.source === 'recorded'
							? 'Historical recorded evidence'
							: 'Current session'} · Numbers retain server precision</Dialog.Description
					>
				</div>
				<Dialog.CloseTrigger
					class="btn preset-outlined-surface-500 text-sm"
					aria-label="Close inspection drawer">Close ×</Dialog.CloseTrigger
				>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				<Tabs value={section} onValueChange={(details) => onSection(details.value)}>
					<Tabs.List
						class="mb-5 flex flex-wrap gap-2 border-b border-surface-200-800 pb-3"
						aria-label="Inspection sections"
						><Tabs.Trigger
							value="proofs"
							class="btn preset-tonal-surface text-xs data-[selected]:preset-filled-primary-500"
							>Row / cell proofs</Tabs.Trigger
						><Tabs.Trigger
							value="facts"
							class="btn preset-tonal-surface text-xs data-[selected]:preset-filled-primary-500"
							>Server facts</Tabs.Trigger
						><Tabs.Trigger
							value="trace"
							class="btn preset-tonal-surface text-xs data-[selected]:preset-filled-primary-500"
							>Tool trace</Tabs.Trigger
						></Tabs.List
					>
					<Tabs.Content value="proofs" class="space-y-6">
						{#if selectedCell}<section
								class="space-y-3 rounded-container border border-surface-200-800 bg-surface-100-900 p-4"
							>
								<h3 class="font-semibold">
									Cell proof · {number(selectedCell.rpm, 0)} RPM / {number(selectedCell.mapKpa)} kPa
								</h3>
								<p class="text-xs text-surface-500">
									Cell coordinates [{selectedCell.rpmIndex}, {selectedCell.mapIndex}]
								</p>
								{#if selectedCell.cell}{@const cell = selectedCell.cell}
									<dl class="grid grid-cols-2 gap-3 text-sm">
										<dt class="text-surface-500">Decision</dt>
										<dd>{cell.status}</dd>
										<dt class="text-surface-500">Original VE</dt>
										<dd class="font-mono">{number(cell.originalVe, 3)}</dd>
										<dt class="text-surface-500">Proposed VE</dt>
										<dd class="font-mono">{number(cell.proposedVe, 3)}</dd>
										<dt class="text-surface-500">Suggested correction</dt>
										<dd class="font-mono">
											{cell.finalCorrectionPct > 0 ? '+' : ''}{number(cell.finalCorrectionPct, 3)}% {#if cell.atBound}<span
													class="badge preset-tonal-warning text-xs">at bound</span
												>{/if}
										</dd>
										<dt class="text-surface-500">Material training samples</dt>
										<dd class="font-mono">{number(cell.materialTrainingSamples, 0)}</dd>
									</dl>
									<ul class="list-inside list-disc space-y-1 text-xs">
										{#each cell.reasons as code (code)}<li title={code}>
												{code.replaceAll('_', ' ').toLowerCase()}
											</li>{:else}<li>No exclusion reason returned.</li>{/each}
									</ul>{:else}<p class="text-sm">
										This recording did not retain this cell's decision. Its values and status are
										unavailable.
									</p>{/if}
								<p class="text-xs text-surface-500">
									Representative samples from adjacent interpolation neighborhoods. These are not a
									complete material-influence audit for this vertex; missing sample proofs remain
									unavailable.
								</p>
								<div class="flex flex-wrap gap-2">
									{#each samples as sample (sample.rowIndex)}<button
											class="btn preset-tonal-primary text-xs"
											onclick={() => onSample(sample)}
											>Row {sample.rowIndex} · {number(sample.timeSec, 3)} s ↗</button
										>{:else}<span class="text-sm text-surface-500"
											>No supporting sample links retained for this cell.</span
										>{/each}
								</div>
							</section>{/if}
						<EligibilityPanel
							{session}
							{page}
							{loading}
							{status}
							{reason}
							{includeInvalidTime}
							{onFilter}
							{onPage}
							{onSelect}
							{onLocate}
						/>
					</Tabs.Content>
					<Tabs.Content value="facts" class="space-y-4"
						><h3 class="font-semibold">Deterministic server facts</h3>
						{#each job?.result?.report?.findings ?? [] as finding, index (index)}<article
								class="space-y-2 rounded-container border border-surface-200-800 p-4"
							>
								<span class="badge preset-tonal-success text-xs"
									>{finding.verification === 'server-numerical'
										? job?.source === 'recorded'
											? 'Recorded server fact'
											: 'Server-verified numerical fact'
										: 'Legacy model finding · evidence cited'}</span
								>
								<p class="text-sm leading-relaxed break-words">{finding.statement}</p>
								<div class="flex flex-wrap gap-2">
									{#each finding.evidenceIds as id (id)}<button
											class="btn preset-tonal-surface text-xs"
											onclick={() => onEvidence(id)}>{id}</button
										>{/each}
								</div>
							</article>{:else}<p class="text-sm text-surface-500">
								No finalized server fact report yet. Inspect the completed tool trace for partial
								evidence.
							</p>{/each}
						{#if job?.result?.report?.limitations.length}<section class="space-y-2 text-sm">
								<h4 class="font-semibold">Report limitations</h4>
								<ul class="list-inside list-disc space-y-2">
									{#each job.result.report.limitations as limitation, i (i)}<li>
											{limitation}
										</li>{/each}
								</ul>
							</section>{/if}
					</Tabs.Content>
					<Tabs.Content value="trace" class="space-y-3"
						><h3 class="font-semibold">
							{job?.source === 'recorded' ? 'Historical' : 'Actual'} agent tool trace
						</h3>
						<p class="text-xs text-surface-500">
							Calls and deterministic replies, not hidden model reasoning. Reason codes are never
							used as evidence references.
						</p>
						{#each trace as entry (entry.evidenceId)}{@const window = windowOf(entry.arguments)}
							<details
								class="rounded-base border border-surface-200-800 p-3"
								open={selectedEvidenceId === entry.evidenceId}
							>
								<summary class="cursor-pointer text-sm font-medium"
									>{entry.result.ok ? '✓' : '!'}
									{entry.tool.replaceAll('_', ' ')} · {entry.evidenceId}</summary
								>
								{#if window}<button
										class="mt-3 btn preset-tonal-primary text-xs"
										onclick={() => onWindow(window.start, window.end)}
										>View {number(window.start)}-{number(window.end)} s on timeline</button
									>{/if}
								{#if entry.result.ok}<div class="mt-3 flex flex-wrap gap-2">
										{#each rowsOf(entry.result.data) as row, i (i)}<button
												class="btn preset-tonal-primary text-xs"
												onclick={() => onSelect(row)}>Row {row}</button
											>{/each}
									</div>{/if}
								<h4 class="mt-4 mb-2 text-xs text-surface-500">Validated arguments</h4>
								<pre
									class="max-h-72 overflow-auto rounded-base bg-surface-200-800 p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(
										entry.arguments,
										null,
										2
									)}</pre>
								<h4 class="mt-4 mb-2 text-xs text-surface-500">
									{entry.result.ok ? 'Deterministic server reply' : 'Tool failure'}
								</h4>
								<pre
									class="max-h-96 overflow-auto rounded-base bg-surface-200-800 p-3 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(
										entry.result,
										null,
										2
									)}</pre>
							</details>{:else}<p class="text-sm text-surface-500">
								No completed tool calls. A running indicator does not imply a tool has finished.
							</p>{/each}</Tabs.Content
					>
				</Tabs>
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
