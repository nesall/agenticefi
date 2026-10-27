import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi, requestObject } from '#lib/server/dashboardHttp.ts';
import { DashboardError, dashboardStore } from '#lib/server/sessionStore.ts';
import { MetaResponsesModel } from '#lib/server/investigation/metaResponsesModel.ts';

export const POST: RequestHandler = (event) =>
	dashboardApi(event, async (owner) => {
		const body = await requestObject(event.request);
		if (
			typeof body.sessionId !== 'string' ||
			typeof body.goal !== 'string' ||
			typeof body.startSec !== 'number' ||
			typeof body.endSec !== 'number'
		)
			throw new DashboardError(400, 'Session, goal and time bounds are required.');
		// Check ownership before creating an API adapter.
		dashboardStore.summary(owner, body.sessionId);
		if (!process.env.META_HACKATHON_API_KEY?.trim())
			throw new DashboardError(
				503,
				'Muse Spark is not configured on this server. Demo analysis is still available.'
			);
		const model = new MetaResponsesModel();
		return dashboardStore.start(
			owner,
			body.sessionId,
			{ goal: body.goal, startSec: body.startSec, endSec: body.endSec },
			model,
			() => model.lastError
		);
	});
