import type {
	EligibilityPage,
	SessionSummary,
	TelemetryResponse
} from '../../shared/types/dashboard';
import type { ChannelSlot } from '../../shared/types/channelMapping';

export class DashboardRequestError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
export type DashboardRequest = <T>(path: string, body?: unknown) => Promise<T>;
export type SampleFilters = {
	status: string;
	reason: string;
	includeInvalidTime: boolean;
	focusRow: number | null;
};

/** Same curated-demo policy for initial Load and Reset. No downsampling or analysis change. */
export function initialTelemetryWindow(
	session: Pick<SessionSummary, 'startSec' | 'endSec' | 'rowCount'>
) {
	return {
		startSec: session.startSec,
		endSec:
			session.rowCount > 8000 ? Math.min(session.endSec, session.startSec + 60) : session.endSec
	};
}
export function sampleQuery(startSec: number, endSec: number, filters: SampleFilters, offset = 0) {
	const params = new URLSearchParams({
		startSec: String(startSec),
		endSec: String(endSec),
		offset: String(offset),
		limit: '12',
		status: filters.status,
		reason: filters.reason,
		includeInvalidTime: String(filters.includeInvalidTime)
	});
	if (filters.focusRow !== null) params.set('focusRow', String(filters.focusRow));
	return params;
}

/** The only commit occurs after both responses succeed and the caller's generation is current. */
export async function loadWindowPair(
	request: DashboardRequest,
	input: {
		sessionId: string;
		startSec: number;
		endSec: number;
		slots: ChannelSlot[];
		filters: SampleFilters;
	},
	isCurrent: () => boolean,
	commit: (pair: { telemetry: TelemetryResponse; eligibility: EligibilityPage }) => void
): Promise<boolean> {
	const params = new URLSearchParams({
		startSec: String(input.startSec),
		endSec: String(input.endSec),
		slots: input.slots.join(',')
	});
	const [telemetry, eligibility] = await Promise.all([
		request<TelemetryResponse>(`/api/sessions/${input.sessionId}/telemetry?${params}`),
		request<EligibilityPage>(
			`/api/sessions/${input.sessionId}/eligibility?${sampleQuery(input.startSec, input.endSec, input.filters)}`
		)
	]);
	if (
		telemetry.sessionId !== input.sessionId ||
		eligibility.sessionId !== input.sessionId ||
		telemetry.startSec !== input.startSec ||
		telemetry.endSec !== input.endSec
	)
		throw new Error('Window responses do not match the requested session and time range.');
	if (!isCurrent()) return false;
	commit({ telemetry, eligibility });
	return true;
}

export function permanentLoss(cause: unknown, scope: 'job' | 'session') {
	if (!(cause instanceof DashboardRequestError) || cause.status !== 404) return null;
	return {
		clearJob: true,
		clearSession: scope === 'session',
		message:
			scope === 'job'
				? 'This investigation is no longer available (expired or server restarted). Reload the demo or start a new investigation; reconnecting cannot restore this job.'
				: 'This telemetry session is no longer available (expired or server restarted). Reload the selected demo to continue.'
	};
}
