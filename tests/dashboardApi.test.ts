import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { POST as demoPost, GET as demoGet } from '../src/routes/api/demo/+server';
import { POST as investigatePost } from '../src/routes/api/investigations/+server';
import { POST as cancelPost } from '../src/routes/api/investigations/[id]/cancel/+server';
import { GET as jobGet } from '../src/routes/api/investigations/[id]/+server';
import { dashboardStore } from '../src/lib/server/sessionStore';
import { context } from './investigation/helpers';

function event(
	path: string,
	body?: unknown,
	owner = 'api-owner',
	origin = 'http://localhost:5173'
) {
	const url = new URL(path, 'http://localhost:5173');
	return {
		url,
		request: new Request(
			url,
			body === undefined
				? {}
				: {
						method: 'POST',
						headers: { Origin: origin, 'Content-Type': 'application/json' },
						body: JSON.stringify(body)
					}
		),
		cookies: { get: () => owner, set: () => {} },
		params: { id: path.split('/')[3] }
	} as unknown as RequestEvent;
}
afterEach(() => vi.unstubAllEnvs());
describe('thin dashboard API contracts (no provider calls)', () => {
	it('lists only allowlisted demos and preserves empty-request April loading', async () => {
		const catalog = await (await demoGet(event('/api/demo'))).json();
		expect(catalog.datasets.map((d: { id: string }) => d.id)).toEqual(['april', 'august8']);
		const result = await demoPost(event('/api/demo', {}));
		expect(result.status).toBe(200);
		expect(await result.json()).toMatchObject({ demoId: 'april', rowCount: 2859 });
	});
	it('rejects arbitrary demo paths, numerical options and cross-origin writes', async () => {
		expect((await demoPost(event('/api/demo', { datasetId: '../data' }))).status).toBe(400);
		expect(
			(await investigatePost(event('/api/investigations', { fitting: { maxCorrectionPct: 50 } })))
				.status
		).toBe(400);
		expect(
			(await demoPost(event('/api/demo', {}, 'api-owner', 'https://foreign.invalid'))).status
		).toBe(403);
	});
	it('checks session ownership before API configuration and never exposes credentials', async () => {
		vi.stubEnv('META_HACKATHON_API_KEY', '');
		vi.stubEnv('META_API_KEY', '');
		const session = dashboardStore.create('api-owner', context());
		const body = {
			sessionId: session.id,
			goal: 'Inspect',
			startSec: session.startSec,
			endSec: session.endSec
		};
		expect(
			(await investigatePost(event('/api/investigations', body, 'foreign-owner'))).status
		).toBe(404);
		const result = await investigatePost(event('/api/investigations', body));
		expect(result.status).toBe(503);
		expect(await result.text()).not.toContain('Authorization');
	});
	it('protects job reads and cancellation by owner and origin', async () => {
		const session = dashboardStore.create('cancel-owner', context());
		const job = dashboardStore.start(
			'cancel-owner',
			session.id,
			{ goal: 'Pause', startSec: session.startSec, endSec: session.endSec },
			{ next: () => new Promise(() => {}) }
		);
		try {
			expect(
				(await jobGet(event(`/api/investigations/${job.id}`, undefined, 'foreign'))).status
			).toBe(404);
			expect(
				(await cancelPost(event(`/api/investigations/${job.id}/cancel`, {}, 'foreign'))).status
			).toBe(404);
			expect(
				(
					await cancelPost(
						event(
							`/api/investigations/${job.id}/cancel`,
							{},
							'cancel-owner',
							'https://foreign.invalid'
						)
					)
				).status
			).toBe(403);
			expect(
				(await cancelPost(event(`/api/investigations/${job.id}/cancel`, {}, 'cancel-owner'))).status
			).toBe(200);
			await vi.waitFor(() =>
				expect(dashboardStore.job('cancel-owner', job.id).state).toBe('finished')
			);
			expect(dashboardStore.job('cancel-owner', job.id).result?.status).toBe('cancelled');
		} finally {
			dashboardStore.cancel('cancel-owner', job.id);
		}
	});
});
