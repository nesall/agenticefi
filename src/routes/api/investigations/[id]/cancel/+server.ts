import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi } from '#lib/server/dashboardHttp.ts';
import { dashboardStore } from '#lib/server/sessionStore.ts';
export const POST: RequestHandler = (event) =>
	dashboardApi(event, (owner) => dashboardStore.cancel(owner, event.params.id!));
