import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi, numberParam } from '#lib/server/dashboardHttp.ts';
import { dashboardStore } from '#lib/server/sessionStore.ts';

export const GET: RequestHandler = (event) =>
	dashboardApi(event, (owner) =>
		dashboardStore.eligibility(owner, event.params.id!, {
			startSec: numberParam(event.url, 'startSec'),
			endSec: numberParam(event.url, 'endSec'),
			offset: numberParam(event.url, 'offset', 0),
			limit: numberParam(event.url, 'limit', 25),
			status: event.url.searchParams.get('status') || undefined,
			reason: event.url.searchParams.get('reason') || undefined,
			focusRow: event.url.searchParams.has('focusRow')
				? numberParam(event.url, 'focusRow')
				: undefined,
			includeInvalidTime: event.url.searchParams.get('includeInvalidTime') === 'true'
		})
	);
