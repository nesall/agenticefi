import { Worker } from 'node:worker_threads';
import type { AnalyticalPresentation } from '../../shared/types/analyticalDashboard';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ToolResult, JsonValue } from '../../shared/types/investigation';
import type {
	AnalyticalEvidenceRef,
	AnalyticalFact,
	AnalyticalWorkerReply
} from '../../shared/types/analyticalInvestigation';
import {
	analyticalSnapshot,
	type AnalyticalInput,
	type AnalyticalSnapshot
} from './analyticalSettings';
import { analyticalArguments, analyticalTools } from './analyticalProtocol';
import { freezeVeArtifact, veContentHash } from '../analysis/veArtifacts';

let liveWorkers = 0;
const MAX_LIVE_WORKERS = 2;

/** Caller owns this server-side handle and must dispose it after evidence review.
 * No global evidence lookup or dashboard route exposes its private artifacts.
 */
export class AnalyticalRun {
	readonly runId = randomUUID();
	readonly contextId: string;
	readonly settingsId: string;
	readonly settings: AnalyticalSnapshot['settings'];
	readonly #snapshot: AnalyticalSnapshot;
	#worker: Worker | undefined;
	#closed = false;
	#busy = false;
	#request = 0;
	#calls = 0;
	#idle: ReturnType<typeof setTimeout> | undefined;
	#pending:
		{ id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
	#refs = new Map<string, AnalyticalEvidenceRef>();
	#facts = new Map<string, AnalyticalFact>();
	#timings: { tool: string; elapsedMs: number }[] = [];
	#claimed = false;

	constructor(input: AnalyticalInput) {
		this.#snapshot = analyticalSnapshot(input);
		this.contextId = input.contextId;
		this.settings = this.#snapshot.settings;
		this.settingsId = veContentHash(this.settings);
		Object.freeze(this); // Private slots stay mutable; public run identity/settings cannot be replaced.
	}
	claim() {
		if (this.#claimed || this.#closed || this.#calls > 0)
			throw new Error('Create a new AnalyticalRun for each investigation.');
		this.#claimed = true;
	}
	get manifest() {
		return structuredClone({
			runId: this.runId,
			settingsId: this.settingsId,
			evidenceRefs: [...this.#refs.values()],
			timings: this.#timings
		});
	}
	get facts(): readonly AnalyticalFact[] {
		return structuredClone([...this.#facts.values()]);
	}
	#expire() {
		clearTimeout(this.#idle);
		this.#idle = setTimeout(() => {
			void this.dispose();
		}, this.settings.limits.retentionMs);
		this.#idle.unref();
	}
	#ensureWorker() {
		if (this.#closed) throw new Error('Analytical run is closed or expired.');
		if (this.#worker) return;
		if (liveWorkers >= MAX_LIVE_WORKERS)
			throw new Error('Analytical worker capacity reached; dispose finished runs before retrying.');
		const path = resolve('.analytical-worker/entry.cjs');
		if (!existsSync(path))
			throw new Error('Analytical worker bundle unavailable; run npm run build:analytical-worker.');
		const worker = new Worker(path, {
			workerData: { runId: this.runId, settingsId: this.settingsId, snapshot: this.#snapshot },
			resourceLimits: {
				maxOldGenerationSizeMb: this.settings.workerHeapMb,
				maxYoungGenerationSizeMb: 32
			}
		});
		this.#worker = worker;
		liveWorkers++;
		worker.unref();
		worker.on(
			'message',
			(message: { id: number; ok: boolean; value?: unknown; error?: string }) => {
				const pending = this.#pending;
				if (!pending || pending.id !== message.id) return;
				if (message.ok) pending.resolve(message.value);
				else {
					pending.reject(new Error(message.error ?? 'Analytical worker failed.'));
					if (/budget exceeded/.test(message.error ?? '')) void this.dispose();
				}
			}
		);
		worker.on('error', (error) => {
			this.#closed = true;
			this.#pending?.reject(
				new Error(`Analytical worker unavailable: ${error.message.slice(0, 400)}`)
			);
		});
		worker.once('exit', () => {
			liveWorkers--;
			this.#worker = undefined;
			this.#closed = true;
			this.#pending?.reject(new Error('Analytical worker terminated; evidence is unavailable.'));
		});
	}
	async #rpc(
		action: 'tool' | 'read' | 'presentation',
		data: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<unknown> {
		if (this.#busy) throw new Error('Concurrent analytical calls are unsupported.');
		if (signal?.aborted) throw new Error('Analytical request cancelled.');
		this.#ensureWorker();
		this.#busy = true;
		clearTimeout(this.#idle);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const abort = () => {
			this.#pending?.reject(new Error('Analytical request cancelled.'));
			void this.dispose();
		};
		try {
			return await new Promise((resolveResult, reject) => {
				const id = ++this.#request;
				this.#pending = { id, resolve: resolveResult, reject };
				timer = setTimeout(() => {
					reject(new Error('Analytical job time budget exceeded.'));
					void this.dispose();
				}, this.settings.limits.jobTimeoutMs);
				signal?.addEventListener('abort', abort, { once: true });
				this.#worker!.postMessage({ id, action, ...data });
			});
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			this.#pending = undefined;
			this.#busy = false;
			if (!this.#closed) this.#expire();
		}
	}
	#reference(id: unknown, kind?: AnalyticalEvidenceRef['kind']) {
		const ref = typeof id === 'string' ? this.#refs.get(id) : undefined;
		if (
			!ref ||
			ref.runId !== this.runId ||
			ref.settingsId !== this.settingsId ||
			(kind && ref.kind !== kind)
		)
			throw new Error('Unknown, cross-run, or wrong-kind evidence reference.');
		return ref;
	}
	async getEvidence(
		reference: AnalyticalEvidenceRef | string,
		signal?: AbortSignal
	): Promise<unknown> {
		const ref = this.#reference(typeof reference === 'string' ? reference : reference.artifactId);
		if (typeof reference !== 'string' && JSON.stringify(reference) !== JSON.stringify(ref))
			throw new Error('Evidence provenance mismatch.');
		const value = await this.#rpc('read', { artifactId: ref.artifactId }, signal);
		if (veContentHash(value) !== ref.sha256) throw new Error('Full evidence checksum mismatch.');
		return freezeVeArtifact(value);
	}
	async getPresentation(signal?: AbortSignal): Promise<AnalyticalPresentation> {
		return (await this.#rpc('presentation', {}, signal)) as AnalyticalPresentation;
	}
	async executeTool(
		name: string,
		args: unknown,
		evidenceId: string,
		signal?: AbortSignal
	): Promise<ToolResult> {
		if (this.#calls >= 20) return { ok: false, error: 'Analytical call budget exceeded.' };
		this.#calls++;
		const started = performance.now();
		const safeName = typeof name === 'string' ? name.slice(0, 100) : 'invalid-tool';
		try {
			if (typeof name !== 'string' || name.length > 100)
				throw new Error('Invalid analytical tool name.');
			if (!/^evidence-[1-9]\d?$/.test(evidenceId)) throw new Error('Invalid server evidence ID.');
			if (Buffer.byteLength(JSON.stringify(args) ?? '') > 20000)
				throw new Error('Analytical arguments exceed 20 KB.');
			if (!analyticalTools.some((tool) => tool.name === name))
				throw new Error(`Unknown analytical tool: ${name}`);
			const input = analyticalArguments(name, args);
			if ('analysisRef' in input) this.#reference(input.analysisRef, 'analysis');
			if (name === 'evaluate_ve_candidate') this.#reference(input.candidateRef, 'candidate');
			const reply = (await this.#rpc(
				'tool',
				{ name, args: input },
				signal
			)) as AnalyticalWorkerReply;
			const facts = reply.facts.map((fact) => {
				const id = `${reply.artifact.artifactId}:${fact.key}`;
				return (
					this.#facts.get(id) ??
					({ ...fact, id, evidenceId, artifact: reply.artifact } as AnalyticalFact)
				);
			});
			const result: ToolResult = {
				ok: true,
				data: {
					...(reply.data as Record<string, JsonValue>),
					runId: this.runId,
					settingsId: this.settingsId,
					fullEvidenceRef: reply.artifact as unknown as JsonValue,
					facts: facts as unknown as JsonValue
				}
			};
			// Trim presentation only; full counts and all evidence remain retained.
			const data = result.data as Record<string, JsonValue>;
			while (Buffer.byteLength(JSON.stringify(result)) > this.settings.limits.maxResponseBytes) {
				const key = ['supportingRows', 'rows', 'cells', 'passes', 'regions', 'neighborhoods'].find(
					(key) => Array.isArray(data[key]) && (data[key] as JsonValue[]).length > 0
				);
				if (!key) throw new Error('Analytical response byte budget exceeded.');
				(data[key] as JsonValue[]).pop();
				const omissions = (data.omittedPresentation ?? {}) as Record<string, JsonValue>;
				omissions[key] = (typeof omissions[key] === 'number' ? omissions[key] : 0) + 1;
				data.omittedPresentation = omissions;
				data.presentationDetailsOmitted =
					(typeof data.presentationDetailsOmitted === 'number'
						? data.presentationDetailsOmitted
						: 0) + 1;
			}
			for (const ref of reply.refs) this.#refs.set(ref.artifactId, freezeVeArtifact(ref));
			for (const fact of facts) this.#facts.set(fact.id, freezeVeArtifact(fact));
			return result;
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message.slice(0, 160) : 'Analytical tool failed.'
			};
		} finally {
			this.#timings.push({ tool: safeName, elapsedMs: performance.now() - started });
		}
	}
	async dispose(): Promise<void> {
		this.#closed = true;
		clearTimeout(this.#idle);
		const worker = this.#worker;
		if (worker) await worker.terminate();
		this.#refs.clear();
	}
}
