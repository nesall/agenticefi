export type JsonValue =
	null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ToolName = 'describe_log' | 'summarize_window' | 'assess_data_quality';
export type ToolDefinition = { name: ToolName; description: string; inputSchema: JsonValue };
export type ToolResult = { ok: true; data: JsonValue } | { ok: false; error: string };
export type ToolTraceEntry = {
	evidenceId: string;
	tool: string;
	arguments: JsonValue;
	result: ToolResult;
};
export type InvestigationFinding = { statement: string; evidenceIds: string[] };
export type InvestigationReport = { findings: InvestigationFinding[]; limitations: string[] };
export type InvestigationResult = {
	status:
		'completed' | 'limit_reached' | 'invalid_response' | 'model_error' | 'timeout' | 'cancelled';
	trace: ToolTraceEntry[];
	report: InvestigationReport | null;
	reason: string | null;
};

/** An adapter receives tool outputs, never the raw session or calibration objects.
 * Return {kind:'tool',name,arguments} or {kind:'final',findings,limitations}.
 */
export interface InvestigationModel {
	next(
		input: {
			goal: string;
			instructions: string;
			tools: readonly ToolDefinition[];
			trace: readonly ToolTraceEntry[];
			remainingCalls: number;
		},
		signal: AbortSignal
	): Promise<unknown>;
}
