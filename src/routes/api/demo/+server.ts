import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { dashboardApi, requestObject } from '#lib/server/dashboardHttp.ts';
import { DashboardError, dashboardStore } from '#lib/server/sessionStore.ts';
import { curatedDemo, demoCatalog, demoId } from '#lib/server/demo/catalog.ts';
export const GET: RequestHandler = () =>
	json({ datasets: demoCatalog() }, { headers: { 'Cache-Control': 'no-store' } });

export const POST: RequestHandler = (event) =>
	dashboardApi(
		event,
		async (owner) => {
			const body = await requestObject(event.request);
			if (Object.keys(body).some((key) => key !== 'datasetId'))
				throw new DashboardError(400, 'Unknown demo option.');
			let id;
			try {
				id = demoId(body.datasetId);
			} catch {
				throw new DashboardError(400, 'Choose April or August 8.');
			}
			if (!demoCatalog().find((demo) => demo.id === id)?.available)
				throw new DashboardError(503, 'The selected demo assets are unavailable on this server.');
			const demo = await curatedDemo(id);
			return dashboardStore.create(owner, demo.context, id);
		},
		true
	);
