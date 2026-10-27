import { describe, expect, it, vi } from 'vitest';
import { DashboardStore } from '../src/lib/server/sessionStore';
import { loadDemo } from '../src/lib/server/demo';
import { context, final, scripted, tool } from './investigation/helpers';

describe('dashboard sessions and serializers', () => {
	it('loads the bundled demo without relying on test files at runtime', () => {
		const demo = loadDemo('demo');
		expect(demo.session.rowCount).toBe(2859);
		expect(demo.session.findChannel('CLT')!.unit).toBe('°F');
		expect(demo.ve.table.rowCount).toBe(16);
		expect(demo.afr.table.rowCount).toBe(12);
	});
	it('scopes sessions to their owner, reuses the demo, and expires state', () => {
		let now = 0;
		const store = new DashboardStore({
			ttlMs: 100,
			maxSessions: 1,
			maxRuns: 2,
			maxActiveRuns: 1,
			now: () => now
		});
		const first = store.create('a', context());
		expect(store.create('a', context()).id).toBe(first.id);
		expect(() => store.summary('b', first.id)).toThrow('unavailable');
		expect(() => store.create('b', context())).toThrow('capacity');
		now = 101;
		expect(() => store.summary('a', first.id)).toThrow('expired');
		expect(store.create('b', context()).id).not.toBe(first.id);
	});
	it('serializes normalized values, genuine zero, and missing cells without fabricating data', () => {
		const store = new DashboardStore();
		const c = context(['0\t1000\t0\t14', '0.1\t1100\t\t15']);
		const session = store.create('a', c);
		const data = store.telemetry('a', session.id, ['load', 'clt'], 0, 0.1);
		expect(data.segments.flat().map((point) => point.values)).toEqual([
			[0, null],
			[null, null]
		]);
		expect(data.segments[0][0].rowIndex).toBe(0);
		expect(JSON.parse(JSON.stringify(data))).toEqual(data);
	});
	it('splits at duplicates, reversals and invalid times, preserving original row identities', () => {
		const store = new DashboardStore();
		const c = context([
			'0\t1000\t50\t14',
			'0.1\t1000\t50\t14',
			'0.1\t1000\t50\t14',
			'0.05\t1000\t50\t14',
			'bad\t1000\t50\t14',
			'0.2\t1000\t50\t14'
		]);
		const session = store.create('a', c);
		const data = store.telemetry('a', session.id, ['rpm'], 0, 1);
		expect(data.invalidTimeCount).toBe(1);
		expect(data.segments.flat().map((p) => p.rowIndex)).toEqual([0, 1, 2, 3, 5]);
		for (const segment of data.segments)
			for (let i = 1; i < segment.length; i++)
				expect(segment[i].timeSec).toBeGreaterThan(segment[i - 1].timeSec);
	});
	it('paginates full-resolution classifications and keeps focus independent of filters', () => {
		const store = new DashboardStore();
		const session = store.create('a', context());
		const page = store.eligibility('a', session.id, {
			startSec: 0,
			endSec: 2,
			limit: 1,
			offset: 1,
			focusRow: 0
		});
		expect(page.samples).toHaveLength(1);
		expect(page.total).toBe(3);
		expect(page.samples[0].rowIndex).toBe(1);
		expect(page.focusedSample!.rowIndex).toBe(0);
		page.samples[0].reasons.length = 0;
		expect(
			store.eligibility('a', session.id, { startSec: 0, endSec: 2 }).samples[1].reasons.length
		).toBeGreaterThan(0);
	});
	it('exposes invalid-time rows through row-based inspection', () => {
		const store = new DashboardStore();
		const session = store.create('a', context(['bad\t1000\t50\t14', '1\t1000\t50\t14']));
		expect(store.eligibility('a', session.id, { startSec: 0, endSec: 2 }).total).toBe(1);
		expect(
			store.eligibility('a', session.id, {
				startSec: 0,
				endSec: 2,
				includeInvalidTime: true,
				focusRow: 0
			}).focusedSample!.timeSec
		).toBeNull();
	});
	it('rejects invalid query bounds, slots and pages', () => {
		const store = new DashboardStore();
		const session = store.create('a', context());
		expect(() => store.telemetry('a', session.id, ['rpm'], NaN, 2)).toThrow();
		expect(() => store.telemetry('a', session.id, ['rpm', 'rpm'], 0, 2)).toThrow();
		expect(() =>
			store.eligibility('a', session.id, { startSec: 0, endSec: 2, limit: 200 })
		).toThrow();
		expect(() =>
			store.eligibility('a', session.id, { startSec: 0, endSec: 2, status: 'unknown' })
		).toThrow();
		expect(() =>
			store.eligibility('a', session.id, { startSec: 0, endSec: 2, focusRow: -1 })
		).toThrow();
	});
});

describe('dashboard investigation lifecycle', () => {
	it('records a bounded asynchronous investigation and isolates its result', async () => {
		const store = new DashboardStore();
		const session = store.create('a', context());
		const job = store.start(
			'a',
			session.id,
			{ goal: 'Inspect', startSec: 0, endSec: 2 },
			scripted(tool('describe_log'), final())
		);
		expect(job.state).toBe('running');
		expect(() => store.job('b', job.id)).toThrow('unavailable');
		await vi.waitFor(() => expect(store.job('a', job.id).state).toBe('finished'));
		expect(store.job('a', job.id).result!.status).toBe('completed');
	});
	it('prevents duplicate running investigations and aborts expired jobs', async () => {
		let now = 0;
		const store = new DashboardStore({
			ttlMs: 100,
			maxSessions: 2,
			maxRuns: 2,
			maxActiveRuns: 1,
			now: () => now
		});
		const session = store.create('a', context());
		const job = store.start(
			'a',
			session.id,
			{ goal: 'Inspect', startSec: 0, endSec: 2 },
			{ next: () => new Promise(() => {}) }
		);
		expect(() =>
			store.start('a', session.id, { goal: 'Inspect', startSec: 0, endSec: 2 }, scripted())
		).toThrow('already running');
		now = 101;
		expect(() => store.job('a', job.id)).toThrow('expired');
		await Promise.resolve();
	});
});
