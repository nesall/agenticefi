/** Deliberately closed vocabulary: provider text may echo credentials or tool data. */
export const providerValues = {
	providerErrorCode: new Set([
		'invalid_request',
		'invalid_request_error',
		'context_length_exceeded',
		'rate_limit_exceeded',
		'server_error',
		'model_not_found',
		'invalid_api_key',
		'invalid_value',
		'missing_required_parameter',
		'unsupported_parameter'
	]),
	providerErrorType: new Set([
		'invalid_request_error',
		'authentication_error',
		'permission_error',
		'rate_limit_error',
		'server_error',
		'api_error'
	]),
	providerErrorParam: new Set([
		'input',
		'previous_response_id',
		'tools',
		'tool_choice',
		'model',
		'max_output_tokens',
		'instructions',
		'parallel_tool_calls',
		'store',
		'text',
		'text.format',
		'text.format.type',
		'text.format.schema'
	]),
	providerErrorHint: new Set([
		'context-limit',
		'continuation-reference',
		'tool-output',
		'request-validation',
		'unclassified'
	])
};
export type ProviderMetadata = Partial<Record<keyof typeof providerValues, string>> & {
	providerRequestId?: string;
};
export const safeRequestId = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|req_[a-f0-9]{16,64})$/i.test(
		value
	);

/** Inspect at most 16 KiB and wait at most 250 ms. Never retain the raw body. */
export async function providerErrorMetadata(response: Response): Promise<ProviderMetadata> {
	const result: ProviderMetadata = {};
	const requestId = response.headers.get('x-request-id');
	if (safeRequestId(requestId)) result.providerRequestId = requestId;
	if (!response.body) return result;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		reader = response.clone().body!.getReader();
		const bodyReader = reader;
		const read = async () => {
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			while (true) {
				const { done, value } = await bodyReader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > 16384) return null;
				chunks.push(value);
			}
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		};
		const payload = await Promise.race([
			read(),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), 250);
			})
		]);
		const error = payload?.error;
		if (!error || typeof error !== 'object' || Array.isArray(error)) return result;
		for (const [field, key] of [
			['providerErrorCode', 'code'],
			['providerErrorType', 'type'],
			['providerErrorParam', 'param']
		] as const) {
			if (providerValues[field].has(error[key])) result[field] = error[key];
		}
		// Classify only; never store even a truncated free-form provider message.
		const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
		result.providerErrorHint = /context.{0,40}(length|limit)|maximum context/.test(message)
			? 'context-limit'
			: /previous_response_id|previous response/.test(message)
				? 'continuation-reference'
				: /function_call_output|call_id|tool output/.test(message)
					? 'tool-output'
					: result.providerErrorType === 'invalid_request_error'
						? 'request-validation'
						: 'unclassified';
	} catch {
		/* Malformed/unreadable errors cannot affect execution. */
	} finally {
		clearTimeout(timer);
		void reader?.cancel().catch(() => {});
	}
	return result;
}
