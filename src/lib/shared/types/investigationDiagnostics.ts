export type TerminationCode =
	| 'completed'
	| 'deadline'
	| 'cancelled'
	| 'session-expired'
	| 'provider-http'
	| 'provider-network'
	| 'provider-protocol'
	| 'provider-incomplete'
	| 'worker-failure'
	| 'worker-timeout'
	| 'invalid-report'
	| 'incomplete-workflow'
	| 'limit-reached'
	| 'setup-failure'
	| 'presentation-failure';

/** Small public status metadata. Full diagnostic events remain private on the server. */
export type InvestigationTermination = {
	code: TerminationCode;
	phase: 'preparing' | 'model' | 'tool' | 'report' | 'presentation' | 'finished';
	modelTurn: number;
	tool: string | null;
	providerStatus?: number;
};
