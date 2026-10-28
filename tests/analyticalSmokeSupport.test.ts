import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	sanitizedJson,
	smokeOutcome,
	tokenCount,
	smokeCheck,
	summarizeUsage,
	persistSmokeReport,
	terminalHttpStatuses
} from './live/analyticalSmokeSupport';

describe('live smoke reporting (offline helpers only)', () => {
	it('distinguishes blocked access, API/protocol failures and incomplete workflows', () => {
		expect(smokeOutcome([401], 'HTTP 401', false, [])).toBe('authentication-or-access-blocker');
		expect(smokeOutcome([403], null, false, [])).toBe('authentication-or-access-blocker');
		expect(smokeOutcome([429], null, false, [])).toBe('api-or-protocol-failure');
		expect(smokeOutcome([200], 'invalid JSON', false, [])).toBe('api-or-protocol-failure');
		expect(smokeOutcome([200], null, true, ['missing evaluation'])).toBe(
			'incomplete-model-workflow'
		);
		expect(smokeOutcome([200], null, false, [])).toBe('incomplete-model-workflow');
		expect(smokeOutcome([200], null, true, [])).toBe('passed');
	});
	it('redacts configured secrets without changing the reported data structure', () => {
		expect(
			JSON.parse(sanitizedJson({ text: 'never abc123 persist', count: 3 }, ['abc123', '']))
		).toEqual({
			text: 'never [REDACTED] persist',
			count: 3
		});
	});
	it('preserves unavailable usage instead of inventing zero tokens', () => {
		expect(tokenCount(undefined)).toBeNull();
		expect(tokenCount(-1)).toBeNull();
		expect(tokenCount(0)).toBe(0);
		expect(tokenCount(42)).toBe(42);
	});
	it('preserves partial usage and marks exactly how many attempts lack each count', () => {
		const known = { input: 100, output: 20, total: 120, cachedInput: 5, reasoningOutput: 10 };
		const unknown = {
			input: null,
			output: null,
			total: null,
			cachedInput: null,
			reasoningOutput: null
		};
		expect(summarizeUsage([{ usage: known }, { usage: unknown }])).toMatchObject({
			status: 'partial',
			inputTokens: 100,
			outputTokens: 20,
			totalTokens: 120,
			fields: { total: { reportingAttempts: 1, missingAttempts: 1 } }
		});
		expect(summarizeUsage([{ usage: known }, { usage: known }])).toMatchObject({
			status: 'complete',
			totalTokens: 240
		});
		expect(summarizeUsage([{ usage: unknown }])).toMatchObject({
			status: 'unavailable',
			inputTokens: null,
			totalTokens: null
		});
		expect(summarizeUsage([])).toMatchObject({ status: 'unavailable', totalTokens: null });
		expect(
			summarizeUsage([{ usage: { ...known, total: 0, input: 0, output: 0 } }]).totalTokens
		).toBe(0);
	});
	it('distinguishes genuine failed checks from unexecuted dependent checks', () => {
		expect(smokeCheck('invalid tool args', false)).toMatchObject({
			status: 'failed',
			passed: false
		});
		expect(smokeCheck('evaluation unavailable after API failure', false, false)).toMatchObject({
			status: 'not-run',
			passed: null
		});
		expect(smokeCheck('checksum', true)).toMatchObject({ status: 'passed', passed: true });
	});
	it('does not classify recovered transient attempts as terminal API failure', () => {
		const attempts = [
			{ modelTurn: 1, httpStatus: 503 },
			{ modelTurn: 1, httpStatus: 200 },
			{ modelTurn: 2, httpStatus: 429 },
			{ modelTurn: 2, httpStatus: 200 }
		];
		expect(terminalHttpStatuses(attempts)).toEqual([200, 200]);
		expect(smokeOutcome(terminalHttpStatuses(attempts), null, true, [])).toBe('passed');
		expect(
			smokeOutcome(
				terminalHttpStatuses([...attempts, { modelTurn: 3, httpStatus: 503 }]),
				'HTTP 503',
				false,
				[]
			)
		).toBe('api-or-protocol-failure');
	});
	it('keeps exclusive timestamped history while updating the latest report without persisting secrets', () => {
		const directory = mkdtempSync(join(tmpdir(), 'agenticefi-smoke-history-'));
		try {
			const latest = join(directory, 'april-v1-live-smoke.json');
			const first = persistSmokeReport(
				latest,
				'2026-10-28T09:00:00.000Z',
				'aaaaaaaa',
				sanitizedJson({ outcome: 'failed', text: 'test-secret' }, ['test-secret'])
			);
			const second = persistSmokeReport(
				latest,
				'2026-10-28T09:00:00.000Z',
				'bbbbbbbb',
				'{"outcome":"passed"}'
			);
			expect(first.archivePath).not.toBe(second.archivePath);
			expect(JSON.parse(readFileSync(first.archivePath, 'utf8'))).toEqual({
				outcome: 'failed',
				text: '[REDACTED]'
			});
			expect(readFileSync(latest, 'utf8')).toBe(readFileSync(second.archivePath, 'utf8'));
			expect(() =>
				persistSmokeReport(latest, '2026-10-28T09:00:00.000Z', 'aaaaaaaa', 'overwrite')
			).toThrow();
			expect(JSON.parse(readFileSync(first.archivePath, 'utf8')).outcome).toBe('failed');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
