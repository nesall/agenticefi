import { describe, it, expect, vi } from 'vitest';
import {
	DashboardRequestError,
	initialTelemetryWindow,
	loadWindowPair,
	permanentLoss,
	type DashboardRequest
} from '../src/lib/components/dashboard/dashboardLoading';
import { DashboardStore } from '../src/lib/server/sessionStore';
import { context } from './investigation/helpers';
import { telemetryFixture } from './telemetryFixtures';
import type { TelemetryResponse, EligibilityPage } from '../src/lib/shared/types/dashboard';

function fixture() {
	const store = new DashboardStore(),
		session = store.create('owner', context(), 'april');
	const telemetry = { ...telemetryFixture(), sessionId: session.id };
	const eligibility = store.eligibility('owner', session.id, { startSec: 0, endSec: 2 });
	return {
		telemetry,
		eligibility,
		input: {
			sessionId: session.id,
			startSec: 0,
			endSec: 2,
			slots: telemetry.slots,
			filters: { status: '', reason: '', includeInvalidTime: false, focusRow: 11 }
		}
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}

describe('atomic telemetry and screening window loading', () => {
	it('uses the supported 60-second initial August window for Reset and keeps the full small April log', () => {
		expect(initialTelemetryWindow({ startSec: 0, endSec: 3800, rowCount: 56284 })).toEqual({
			startSec: 0,
			endSec: 60
		});
		expect(initialTelemetryWindow({ startSec: 10, endSec: 45, rowCount: 9000 })).toEqual({
			startSec: 10,
			endSec: 45
		});
		expect(initialTelemetryWindow({ startSec: 0, endSec: 190.463, rowCount: 2859 })).toEqual({
			startSec: 0,
			endSec: 190.463
		});
	});
	it('commits charts, screening and matching range only when both requests succeed', async () => {
		const f = fixture(),
			t = deferred<TelemetryResponse>(),
			s = deferred<EligibilityPage>(),
			commit = vi.fn(),
			urls: string[] = [];
		const request: DashboardRequest = async <T>(url: string) => {
			urls.push(url);
			return (await (url.includes('/telemetry?') ? t.promise : s.promise)) as T;
		};
		const pending = loadWindowPair(request, f.input, () => true, commit);
		s.resolve(f.eligibility);
		await Promise.resolve();
		expect(commit).not.toHaveBeenCalled();
		t.resolve(f.telemetry);
		expect(await pending).toBe(true);
		expect(commit).toHaveBeenCalledExactlyOnceWith({
			telemetry: f.telemetry,
			eligibility: f.eligibility
		});
		for (const url of urls) {
			const query = new URL(url, 'http://test').searchParams;
			expect(query.get('startSec')).toBe('0');
			expect(query.get('endSec')).toBe('2');
		}
		expect(new URL(urls[1], 'http://test').searchParams.get('focusRow')).toBe('11');
	});
	it.each(['telemetry', 'eligibility'])(
		'retains the previous matched pair when %s fails',
		async (failing) => {
			const f = fixture(),
				oldPair = { telemetry: f.telemetry, eligibility: f.eligibility };
			let displayed = oldPair;
			const request: DashboardRequest = async <T>(url: string) => {
				if (url.includes(`/${failing}?`)) throw new DashboardRequestError(413, 'Window too large');
				return (url.includes('/telemetry?') ? f.telemetry : f.eligibility) as T;
			};
			await expect(
				loadWindowPair(
					request,
					f.input,
					() => true,
					(pair) => (displayed = pair)
				)
			).rejects.toThrow('Window too large');
			expect(displayed).toBe(oldPair);
		}
	);
	it('discards a completed older request after a newer range or session becomes current', async () => {
		const f = fixture(),
			t = deferred<TelemetryResponse>(),
			commit = vi.fn();
		let current = true;
		const request: DashboardRequest = async <T>(url: string) =>
			(await (url.includes('/telemetry?') ? t.promise : Promise.resolve(f.eligibility))) as T;
		const pending = loadWindowPair(request, f.input, () => current, commit);
		current = false;
		t.resolve(f.telemetry);
		expect(await pending).toBe(false);
		expect(commit).not.toHaveBeenCalled();
	});
	it('rejects mismatched server session or range rather than displaying mixed evidence', async () => {
		const f = fixture(),
			commit = vi.fn();
		const request: DashboardRequest = async <T>(url: string) =>
			(url.includes('/telemetry?') ? { ...f.telemetry, endSec: 99 } : f.eligibility) as T;
		await expect(loadWindowPair(request, f.input, () => true, commit)).rejects.toThrow(
			'do not match'
		);
		expect(commit).not.toHaveBeenCalled();
	});
});

describe('permanent job/session loss', () => {
	it('releases the stale job lock while preserving a potentially valid session for another run', () => {
		const loss = permanentLoss(new DashboardRequestError(404, 'gone'), 'job');
		expect(loss).toMatchObject({ clearJob: true, clearSession: false });
		expect(loss?.message).toContain('start a new investigation');
		expect(loss?.message).toContain('reconnecting cannot restore');
	});
	it('invalidates both charts and screening with a lost session and permits demo reload', () => {
		const loss = permanentLoss(new DashboardRequestError(404, 'gone'), 'session');
		expect(loss).toMatchObject({ clearJob: true, clearSession: true });
		expect(loss?.message).toContain('Reload the selected demo');
	});
	it.each([
		new DashboardRequestError(500, 'temporary'),
		new DashboardRequestError(429, 'busy'),
		new Error('network')
	])('does not release an active run on a transient failure: %s', (cause) => {
		expect(permanentLoss(cause, 'job')).toBeNull();
	});
});
