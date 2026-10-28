import type { ToolDefinition } from '../../shared/types/investigation';
import { investigationTools } from './tools';

const neighborhoods = {
	type: 'array',
	maxItems: 8,
	minItems: 1,
	items: {
		type: 'object',
		additionalProperties: false,
		required: ['rpmIndex', 'mapIndex'],
		properties: {
			rpmIndex: { type: 'integer', minimum: 0 },
			mapIndex: { type: 'integer', minimum: 0 }
		}
	}
};
const rowIndices = {
	type: 'array',
	maxItems: 12,
	minItems: 1,
	uniqueItems: true,
	items: { type: 'integer', minimum: 0 }
};
export const analyticalTools: readonly ToolDefinition[] = [
	...investigationTools.filter((tool) => tool.name !== 'assess_sample_eligibility'),
	{
		name: 'analyze_afr_error',
		description:
			'Summarize frozen training AFR error by VE interpolation neighborhood. Optional region/row selection changes inspection only, never fitting. Returns server facts and full evidence references.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: { neighborhoods, rowIndices }
		}
	},
	{
		name: 'fit_ve_candidate',
		description:
			'Fit the one frozen training-only candidate. Lazily prepares canonical analysis; no prerequisite call is needed. Repeated calls inspect the cached result. No-correction is valid. No parameters or masks can be changed.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: { analysisRef: { type: 'string' }, cells: neighborhoods }
		}
	},
	{
		name: 'evaluate_ve_candidate',
		description:
			'Evaluate a finalized candidate on all fixed holdout rows with the existing paired model predictor. Changes are predictions, not measured gains. Worsened metrics are valid. Selections affect returned details only.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['candidateRef'],
			properties: { candidateRef: { type: 'string' }, neighborhoods, rowIndices }
		}
	}
];

export function analyticalArguments(name: string, args: unknown): Record<string, unknown> {
	if (!args || typeof args !== 'object' || Array.isArray(args))
		throw new Error('Arguments must be an object.');
	const input = args as Record<string, unknown>;
	const keys =
		name === 'analyze_afr_error'
			? ['neighborhoods', 'rowIndices']
			: name === 'fit_ve_candidate'
				? ['analysisRef', 'cells']
				: name === 'evaluate_ve_candidate'
					? ['candidateRef', 'neighborhoods', 'rowIndices']
					: null;
	if (!keys) return input; // Existing inspection tools retain their existing validators.
	if (Object.keys(input).some((key) => !keys.includes(key)))
		throw new Error(
			'Unknown analytical argument; settings, masks and vectors are caller-controlled.'
		);
	for (const key of ['analysisRef', 'candidateRef'])
		if (
			key in input &&
			(typeof input[key] !== 'string' || !input[key].length || input[key].length > 160)
		)
			throw new Error(`Invalid ${key}.`);
	if (name === 'evaluate_ve_candidate' && !('candidateRef' in input))
		throw new Error('candidateRef is required.');
	for (const key of ['neighborhoods', 'cells'])
		if (key in input) {
			const list = input[key];
			if (!Array.isArray(list) || list.length < 1 || list.length > 8)
				throw new Error(`${key} must contain 1-8 entries.`);
			const seen = new Set<string>();
			for (const item of list) {
				if (
					!item ||
					typeof item !== 'object' ||
					Array.isArray(item) ||
					Object.keys(item).sort().join(',') !== 'mapIndex,rpmIndex' ||
					![item.rpmIndex, item.mapIndex].every((v) => Number.isSafeInteger(v) && v >= 0)
				)
					throw new Error('Invalid cell/neighborhood index.');
				const id = `${item.rpmIndex},${item.mapIndex}`;
				if (seen.has(id)) throw new Error('Duplicate region.');
				seen.add(id);
			}
		}
	if ('rowIndices' in input) {
		const rows = input.rowIndices;
		if (
			!Array.isArray(rows) ||
			rows.length < 1 ||
			rows.length > 12 ||
			new Set(rows).size !== rows.length ||
			!rows.every((v) => Number.isSafeInteger(v) && v >= 0)
		)
			throw new Error('rowIndices must contain 1-12 unique nonnegative integers.');
	}
	return input;
}
