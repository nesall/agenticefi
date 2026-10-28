import type { InvestigationJob } from '../../shared/types/dashboard';

export function investigationStatus(job: InvestigationJob): string {
	if (job.state === 'running') return 'Running';
	const code = job.termination?.code;
	if (code === 'deadline' || job.result?.status === 'timeout') return 'Deadline exceeded / partial';
	if (code === 'session-expired') return 'Session expired / partial';
	if (job.outcome === 'cancelled' || job.result?.status === 'cancelled') return 'Cancelled';
	if (code === 'incomplete-workflow') return 'Incomplete model workflow / partial';
	if (code?.startsWith('provider-')) return 'Provider error / partial';
	if (code?.startsWith('worker-')) return 'Worker failure / partial';
	if (code === 'invalid-report') return 'Invalid model report / partial';
	if (code === 'limit-reached') return 'Run limit reached / partial';
	return job.error || job.result?.status !== 'completed' ? 'Failed / partial' : 'Completed';
}
