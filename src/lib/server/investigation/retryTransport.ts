import { setTimeout as delay } from 'node:timers/promises';

export const RETRYABLE_STATUSES = [429, 500, 502, 503, 504] as const;
export const MAX_RETRIES = 2;
export const MAX_RETRY_DELAY_MS = 10000;

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		const ms = Number(trimmed) * 1000;
		return Number.isSafeInteger(ms) ? ms : Number.POSITIVE_INFINITY;
	}
	// Require an HTTP-date shape, not Date.parse's permissive interpretation of arbitrary strings.
	if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) return null;
	const timestamp = Date.parse(trimmed);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

export function safeResponseHeaders(headers: Headers) {
	const ids: Record<string, string> = {};
	for (const name of ['x-request-id', 'request-id', 'x-fb-request-id', 'x-fb-trace-id']) {
		const value = headers.get(name);
		if (value && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value)) ids[name] = value;
	}
	const raw = headers.get('retry-after');
	return {
		requestIds: ids,
		retryAfter: raw && retryAfterMs(raw) !== null ? raw.slice(0, 80) : null
	};
}

export type RetryEvent = {
	attempt: number;
	status: number;
	retryDelayMs: number | null;
	decision: 'retry' | 'disabled' | 'not-transient' | 'exhausted' | 'retry-after-exceeds-cap';
};

/** Smoke-only HTTP resilience. No retries of authentication, protocol errors,
 * ambiguous network failures, successful responses, or deterministic tools.
 * The runner's original AbortSignal applies to all requests and backoff waits.
 */
export function retryingTransport(
	transport: typeof fetch,
	options: {
		maxRetries: number;
		onDecision?: (event: RetryEvent) => void;
		random?: () => number;
		now?: () => number;
		wait?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
	}
): typeof fetch {
	if (
		!Number.isInteger(options.maxRetries) ||
		options.maxRetries < 0 ||
		options.maxRetries > MAX_RETRIES
	)
		throw new Error('Smoke retries must be between zero and two.');
	const wait =
		options.wait ?? ((ms, signal) => delay(ms, undefined, { signal: signal ?? undefined }));
	return async (input, init) => {
		const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
		for (let attempt = 1; ; attempt++) {
			signal?.throwIfAborted();
			// The adapter supplies a replayable JSON string body; never retry arbitrary streams.
			const response = await transport(input, init);
			const transient = (RETRYABLE_STATUSES as readonly number[]).includes(response.status);
			let decision: RetryEvent['decision'] = 'not-transient';
			let retryDelayMs: number | null = null;
			if (transient) {
				if (options.maxRetries === 0) decision = 'disabled';
				else if (attempt > options.maxRetries) decision = 'exhausted';
				else {
					const after = retryAfterMs(
						response.headers.get('retry-after'),
						options.now?.() ?? Date.now()
					);
					if (after !== null && after > MAX_RETRY_DELAY_MS) decision = 'retry-after-exceeds-cap';
					else {
						decision = 'retry';
						const jitter = Math.max(0, Math.min(1, (options.random ?? Math.random)()));
						retryDelayMs = Math.max(
							after ?? 0,
							Math.floor(500 * 2 ** (attempt - 1) * (0.5 + jitter * 0.5))
						);
					}
				}
			}
			if (decision === 'retry' && (typeof input !== 'string' || typeof init?.body !== 'string'))
				throw new Error('Smoke retry requires the adapter JSON string request.');
			options.onDecision?.({ attempt, status: response.status, retryDelayMs, decision });
			if (decision !== 'retry') return response;
			// Discard the transient error body without reading or logging it.
			await response.body?.cancel();
			await wait(retryDelayMs!, signal);
		}
	};
}
