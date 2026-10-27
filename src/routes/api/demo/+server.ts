import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi } from '#lib/server/dashboardHttp.ts';
import { dashboardStore } from '#lib/server/sessionStore.ts';
import { loadDemo } from '#lib/server/demo/index.ts';

export const POST: RequestHandler = (event) =>
	dashboardApi(event, (owner) => dashboardStore.create(owner, loadDemo(crypto.randomUUID())), true);
