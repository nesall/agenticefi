import { json, type RequestEvent } from '@sveltejs/kit';
import { DashboardError } from './sessionStore';

export async function dashboardApi(
	event: RequestEvent,
	action: (owner: string) => unknown | Promise<unknown>,
	createOwner = false
): Promise<Response> {
	try {
		if (event.request.method === 'POST' && event.request.headers.get('origin') !== event.url.origin)
			throw new DashboardError(403, 'This action must originate from the dashboard.');
		let owner = event.cookies.get('agenticefi_owner');
		if (!owner && createOwner) {
			owner = crypto.randomUUID();
			event.cookies.set('agenticefi_owner', owner, {
				path: '/',
				httpOnly: true,
				sameSite: 'strict',
				secure: event.url.protocol === 'https:',
				maxAge: 8 * 60 * 60
			});
		}
		if (!owner) throw new DashboardError(404, 'Load the demo to start a session.');
		const result = await action(owner);
		if (result instanceof Response) return result;
		return json(result, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		return json(
			{
				error:
					error instanceof DashboardError
						? error.message
						: 'The dashboard request could not be completed.'
			},
			{
				status: error instanceof DashboardError ? error.status : 500,
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	}
}
export function numberParam(url: URL, key: string, fallback?: number): number {
	const raw = url.searchParams.get(key);
	if (raw === null && fallback !== undefined) return fallback;
	if (raw === null || !raw.trim() || !Number.isFinite(Number(raw)))
		throw new DashboardError(400, `Invalid ${key}.`);
	return Number(raw);
}
export async function requestObject(request: Request): Promise<Record<string, unknown>> {
	let text: string;
	try {
		text = await request.text();
	} catch (error) {
		// adapter-node rejects oversized streams before our own JSON-size check.
		if (error && typeof error === 'object' && 'status' in error && error.status === 413)
			throw new DashboardError(413, 'Request is too large.');
		throw error;
	}
	if (text.length > 8192) throw new DashboardError(413, 'Request is too large.');
	try {
		const data: unknown = JSON.parse(text);
		if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
		return data as Record<string, unknown>;
	} catch {
		throw new DashboardError(400, 'Expected a JSON object.');
	}
}
