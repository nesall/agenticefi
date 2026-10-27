import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi } from '#lib/server/dashboardHttp.ts';
import { dashboardStore } from '#lib/server/sessionStore.ts';

export const GET: RequestHandler = (event) =>
	dashboardApi(event, (owner) => dashboardStore.job(owner, event.params.id!));
