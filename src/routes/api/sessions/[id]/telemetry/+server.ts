import type { RequestHandler } from '@sveltejs/kit';
import { dashboardApi, numberParam } from '#lib/server/dashboardHttp.ts';
import { dashboardStore } from '#lib/server/sessionStore.ts';
import type { ChannelSlot } from '#lib/shared/types/channelMapping.ts';

export const GET: RequestHandler = (event) =>
	dashboardApi(event, (owner) =>
		dashboardStore.telemetry(
			owner,
			event.params.id!,
			(event.url.searchParams.get('slots') ?? 'rpm,load,afr').split(',') as ChannelSlot[],
			numberParam(event.url, 'startSec'),
			numberParam(event.url, 'endSec')
		)
	);
