import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SmokeOutcome =
	| 'passed'
	| 'dataset-unavailable'
	| 'resource-limit'
	| 'harness-process-failure'
	| 'authentication-or-access-blocker'
	| 'api-or-protocol-failure'
	| 'incomplete-model-workflow';

export function smokeOutcome(
	httpStatuses: readonly number[],
	adapterError: string | null,
	completed: boolean,
	failedChecks: readonly string[]
): SmokeOutcome {
	if (httpStatuses.some((status) => [401, 403].includes(status)))
		return 'authentication-or-access-blocker';
	if (adapterError || httpStatuses.some((status) => status >= 400))
		return 'api-or-protocol-failure';
	return completed && failedChecks.length === 0 ? 'passed' : 'incomplete-model-workflow';
}

/** Exact-secret redaction is a final backstop; request headers/bodies are never recorded. */
export function sanitizedJson(value: unknown, secrets: readonly string[]): string {
	let text = JSON.stringify(value, null, 2);
	for (const secret of secrets.filter((s) => s.length > 0))
		text = text.split(secret).join('[REDACTED]');
	return text;
}

export function tokenCount(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export type UsageCounts = {
	input: number | null;
	output: number | null;
	total: number | null;
	cachedInput: number | null;
	reasoningOutput: number | null;
};

export function summarizeUsage(attempts: readonly { usage: UsageCounts }[]) {
	const sum = (field: keyof UsageCounts) => {
		const available = attempts.flatMap((a) => (a.usage[field] === null ? [] : [a.usage[field]!]));
		return {
			knownTokens: available.length ? available.reduce((s, n) => s + n, 0) : null,
			reportingAttempts: available.length,
			missingAttempts: attempts.length - available.length
		};
	};
	const fields = {
		input: sum('input'),
		output: sum('output'),
		total: sum('total'),
		cachedInput: sum('cachedInput'),
		reasoningOutput: sum('reasoningOutput')
	};
	const complete =
		attempts.length > 0 &&
		['input', 'output', 'total'].every(
			(field) => fields[field as 'input' | 'output' | 'total'].missingAttempts === 0
		);
	return {
		status: complete
			? 'complete'
			: fields.total.reportingAttempts ||
				  fields.input.reportingAttempts ||
				  fields.output.reportingAttempts
				? 'partial'
				: 'unavailable',
		inputTokens: fields.input.knownTokens,
		outputTokens: fields.output.knownTokens,
		totalTokens: fields.total.knownTokens,
		fields,
		attempts: attempts.length,
		limitation:
			'Totals sum only provider-reported usage across all HTTP attempts. Missing usage is unknown, never zero; partial totals are not a complete billing estimate.'
	};
}

export type SmokeCheck = {
	name: string;
	passed: boolean | null;
	status: 'passed' | 'failed' | 'not-run';
	reason: string | null;
};
export function smokeCheck(name: string, passed: boolean, assessed = true): SmokeCheck {
	return {
		name,
		passed: assessed ? passed : null,
		status: assessed ? (passed ? 'passed' : 'failed') : 'not-run',
		reason: assessed
			? null
			: 'Prerequisite evidence or final response was not reached; see upstream execution failure.'
	};
}

/** Keep a stable latest report plus an exclusive, immutable per-execution archive. */
export function persistSmokeReport(
	latestPath: string,
	startedAt: string,
	runToken: string,
	serialized: string
) {
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(startedAt) ||
		!/^[a-f0-9-]{8,36}$/.test(runToken) ||
		!latestPath.endsWith('.json')
	)
		throw new Error('Invalid smoke report identity.');
	const archivePath = latestPath.replace(
		/\.json$/,
		`-${startedAt.replace(/[:.]/g, '-')}-${runToken}.json`
	);
	mkdirSync(dirname(latestPath), { recursive: true });
	writeFileSync(archivePath, serialized, { flag: 'wx' });
	writeFileSync(latestPath, serialized);
	return { archivePath, latestPath };
}

/** Only final attempts determine execution success; recovered 503s remain in history. */
export function terminalHttpStatuses(
	attempts: readonly { modelTurn: number; httpStatus: number | null }[]
): number[] {
	const final = new Map<number, number | null>();
	for (const attempt of attempts) final.set(attempt.modelTurn, attempt.httpStatus);
	return [...final.values()].filter((value): value is number => value !== null);
}
