import type { RequestHandler } from '@sveltejs/kit';
import { metaApiKey } from '#lib/server/investigation/metaApiKey.ts';
import { dashboardApi, requestObject } from '#lib/server/dashboardHttp.ts';
import { DashboardError, dashboardStore } from '#lib/server/sessionStore.ts';
import { MetaResponsesModel } from '#lib/server/investigation/metaResponsesModel.ts';
import { retryingTransport } from '#lib/server/investigation/retryTransport.ts';
import {
	InvestigationDiagnostics,
	diagnosticTransport
} from '#lib/server/investigation/diagnostics.ts';

export const POST: RequestHandler = (event) =>
	dashboardApi(event, async (owner) => {
		const body = await requestObject(event.request);
		if (
			Object.keys(body).some(
				(key) =>
					![
						'sessionId',
						'goal',
						'startSec',
						'endSec',
						'mode',
						'profile',
						'source',
						'resilient'
					].includes(key)
			)
		)
			throw new DashboardError(400, 'Unknown investigation option.');
		const mode = body.mode ?? 'legacy',
			profile = body.profile ?? 'v1',
			source = body.source ?? 'live';
		if (
			(mode !== 'legacy' && mode !== 'analytical') ||
			(profile !== 'v1' && profile !== 'v2-experimental') ||
			(source !== 'live' && source !== 'recorded') ||
			(body.resilient !== undefined && typeof body.resilient !== 'boolean')
		)
			throw new DashboardError(400, 'Invalid investigation options.');
		if (
			typeof body.sessionId !== 'string' ||
			typeof body.goal !== 'string' ||
			typeof body.startSec !== 'number' ||
			typeof body.endSec !== 'number'
		)
			throw new DashboardError(400, 'Session, goal and time bounds are required.');
		// Check ownership before creating an API adapter.
		dashboardStore.summary(owner, body.sessionId);
		const apiKey = metaApiKey();
		if (!apiKey && source !== 'recorded')
			throw new DashboardError(
				503,
				'Muse Spark is not configured on this server. Demo analysis is still available.'
			);
		const diagnostics =
			mode === 'analytical' && source === 'live' ? new InvestigationDiagnostics() : undefined;
		const observedFetch = diagnostics ? diagnosticTransport(fetch, diagnostics) : fetch;
		const model =
			source === 'recorded'
				? null
				: new MetaResponsesModel({
						apiKey,
						diagnostics,
						transport:
							mode === 'analytical'
								? retryingTransport(observedFetch, {
										maxRetries: body.resilient ? 2 : 0,
										onDecision: (event) =>
											diagnostics?.event('retry', {
												...event,
												retryCount: event.decision === 'retry' ? event.attempt : event.attempt - 1
											})
									})
								: observedFetch
					});
		return dashboardStore.start(
			owner,
			body.sessionId,
			{ goal: body.goal, startSec: body.startSec, endSec: body.endSec, mode, profile, source },
			model,
			() => model?.lastError ?? null,
			diagnostics
		);
	});
