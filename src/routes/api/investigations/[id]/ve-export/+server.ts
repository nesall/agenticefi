import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi } from '#lib/server/dashboardHttp.ts';
import { dashboardStore, DashboardError } from '#lib/server/sessionStore.ts';

export const GET: RequestHandler = (event) =>
	dashboardApi(event, (owner) => {
		const format = event.url.searchParams.get('format') ?? 'csv';
		if (format !== 'csv' && format !== 'json')
			throw new DashboardError(400, 'Unsupported advisory export format.');
		const download = dashboardStore.downloadVe(owner, event.params.id!, format);
		return new Response(download.body, {
			headers: {
				'Content-Type':
					format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="${download.filename}"`,
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	});
