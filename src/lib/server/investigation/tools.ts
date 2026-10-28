import type { ChannelSlot } from '../../shared/types/channelMapping';
import type { JsonValue, ToolDefinition, ToolResult } from '../../shared/types/investigation';
import type { InspectionContext } from './context';
import { classifySampleEligibility, summarizeEligibility } from '../analysis/sampleEligibility';

const objectSchema = { type: 'object', properties: {}, additionalProperties: false };
export const investigationTools: readonly ToolDefinition[] = [
	{
		name: 'describe_log',
		description:
			'Describe available channels, validated mappings, parsed time bounds and calibration metadata.',
		inputSchema: objectSchema
	},
	{
		name: 'assess_data_quality',
		description:
			'Count invalid times, inversions, duplicates, and unresolved channels. This does not establish tuning eligibility.',
		inputSchema: objectSchema
	},
	{
		name: 'summarize_window',
		description:
			'Compute normalized channel statistics for inclusive parsed-time bounds. Missing values are excluded and counted.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['startSec', 'endSec', 'slots'],
			properties: {
				startSec: { type: 'number' },
				endSec: { type: 'number' },
				slots: {
					type: 'array',
					minItems: 1,
					maxItems: 8,
					uniqueItems: true,
					items: {
						type: 'string',
						enum: [
							'rpm',
							'load',
							'afr',
							'lambda',
							'tps',
							'tpsDot',
							'mapDot',
							'clt',
							'mat',
							'egt1',
							'egt2',
							'pw',
							'timing',
							'duty1',
							'duty2',
							'fan1duty',
							'fan2duty',
							'fuelwarmcor'
						]
					}
				}
			}
		}
	},
	{
		name: 'assess_sample_eligibility',
		description:
			'Screen samples using the caller-configured steady-state AFR/VE profile. Reports hard/heuristic exclusions and unassessed checks, with thresholds and bounded row evidence. Does not prove tuning safety or calculate corrections.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['startSec', 'endSec'],
			properties: {
				startSec: { type: 'number' },
				endSec: { type: 'number' },
				maxSamples: { type: 'integer', minimum: 0, maximum: 20 }
			}
		}
	}
];

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Arguments must be an object.');
	return value as Record<string, unknown>;
}

function timeInfo(context: InspectionContext) {
	const channel = context.session.channelByIndex(context.session.timeChannelIndex ?? -1);
	if (
		!channel ||
		channel.isBoolean ||
		channel.isTimestamp ||
		!['s', 'sec', 'seconds'].includes(channel.unit.trim().toLowerCase())
	) {
		return {
			values: null,
			min: null,
			max: null,
			reason: 'A Time channel with explicit seconds units is required.'
		};
	}
	let min = Infinity,
		max = -Infinity;
	for (const value of channel.values)
		if (Number.isFinite(value)) {
			min = Math.min(min, value);
			max = Math.max(max, value);
		}
	return {
		values: channel.values,
		min: Number.isFinite(min) ? min : null,
		max: Number.isFinite(max) ? max : null,
		reason: null
	};
}

/** This is the runtime validation boundary for every model-originated tool call. */
export function executeInvestigationTool(
	context: InspectionContext,
	name: string,
	args: unknown
): ToolResult {
	try {
		const input = object(args);
		const session = context.session;
		const mapping = session.channelMapping;
		const slots = Object.keys(mapping.toJSON()) as ChannelSlot[];
		const time = timeInfo(context);
		if (name === 'assess_sample_eligibility') {
			if (Object.keys(input).some((key) => !['startSec', 'endSec', 'maxSamples'].includes(key)))
				throw new Error(
					'Unknown eligibility argument; thresholds are controlled by the caller profile.'
				);
			const { startSec, endSec, maxSamples = 10 } = input;
			if (
				typeof startSec !== 'number' ||
				typeof endSec !== 'number' ||
				!Number.isFinite(startSec) ||
				!Number.isFinite(endSec) ||
				startSec > endSec
			)
				throw new Error('Finite ordered window bounds are required.');
			if (
				typeof maxSamples !== 'number' ||
				!Number.isInteger(maxSamples) ||
				maxSamples < 0 ||
				maxSamples > 20
			)
				throw new Error('maxSamples must be an integer from 0 to 20.');
			if (!time.values) throw new Error(time.reason!);
			const classified = classifySampleEligibility(session, context.eligibilityProfile);
			const selected = classified.samples.filter(
				(sample) =>
					sample.timeSec !== null && sample.timeSec >= startSec && sample.timeSec <= endSec
			);
			const details: typeof selected = [];
			let detailBytes = 0;
			for (const sample of selected.slice(0, maxSamples)) {
				const bytes = Buffer.byteLength(JSON.stringify(sample));
				if (detailBytes + bytes > 32000) break;
				details.push(sample);
				detailBytes += bytes;
			}
			return {
				ok: true,
				data: {
					contextId: context.id,
					startSec,
					endSec,
					classifierVersion: classified.classifierVersion,
					config: classified.config,
					resolutions: classified.resolutions as JsonValue[],
					summary: summarizeEligibility(selected) as unknown as JsonValue,
					fullLogSummary: classified.summary as unknown as JsonValue,
					unlocatableTimeCount: classified.samples.filter((sample) => sample.timeSec === null)
						.length,
					samples: details as unknown as JsonValue,
					omittedSampleDetails: selected.length - details.length,
					limitations: [
						...context.limitations,
						...classified.limitations,
						'All preceding parsed samples are classified before selecting the inclusive window; omitted sample details remain included in counts.'
					]
				}
			};
		}
		if (name === 'describe_log' || name === 'assess_data_quality') {
			if (Object.keys(input).length) throw new Error('This tool takes no arguments.');
			const resolutions = slots.map((slot) => mapping.resolve(slot, session));
			if (name === 'describe_log') {
				const calibration = (kind: 've' | 'afr'): JsonValue => {
					const source = context[kind];
					if (!source) return { kind, calibrationId: context.calibrationId, status: 'unavailable' };
					return {
						kind,
						calibrationId: context.calibrationId,
						xAxisName: source.xAxisName,
						yAxisName: source.yAxisName,
						rows: source.table.rowCount,
						columns: source.table.columnCount,
						xBreakpoints: source.table.xBreakpoints,
						yBreakpoints: source.table.yBreakpoints,
						author: source.author ?? null,
						writeDate: source.writeDate ?? null
					};
				};
				return {
					ok: true,
					data: {
						contextId: context.id,
						logName: context.logName,
						logEncoding: context.logEncoding,
						rowCount: session.rowCount,
						channelCount: session.channels.length,
						channels: session.channels
							.slice(0, 200)
							.map((ch) => ({ name: ch.name, unit: ch.unit })),
						omittedChannels: Math.max(0, session.channels.length - 200),
						mappings: resolutions as JsonValue[],
						time: { startSec: time.min, endSec: time.max, reason: time.reason },
						calibration: [calibration('ve'), calibration('afr')],
						limitations: [...context.limitations]
					}
				};
			}
			const discontinuities = time.values ? session.discontinuities : [];
			let invalidTimeCount = 0,
				duplicateTimeCount = 0,
				timeInversionCount = 0;
			if (time.values)
				for (let row = 0; row < time.values.length; row++) {
					const value = time.values[row];
					if (!Number.isFinite(value)) {
						invalidTimeCount++;
						continue;
					}
					if (row && Number.isFinite(time.values[row - 1])) {
						if (value === time.values[row - 1]) duplicateTimeCount++;
						else if (value < time.values[row - 1]) timeInversionCount++;
					}
				}
			return {
				ok: true,
				data: {
					contextId: context.id,
					rowCount: session.rowCount,
					timeAvailable: time.values !== null,
					timeReason: time.reason,
					invalidTimeCount: time.values ? invalidTimeCount : null,
					duplicateTimeCount: time.values ? duplicateTimeCount : null,
					timeInversionCount: time.values ? timeInversionCount : null,
					channelIssues: resolutions.filter((r) => r.status !== 'resolved') as JsonValue[],
					discontinuityCount: time.values ? discontinuities.length : null,
					discontinuities: discontinuities.slice(0, 50).map((d) => ({
						...d,
						timeSec: Number.isFinite(d.timeSec) ? d.timeSec : null,
						durationSec: Number.isFinite(d.durationSec) ? d.durationSec : null
					})),
					omittedDiscontinuities: Math.max(0, discontinuities.length - 50),
					limitations: [
						...context.limitations,
						'Discontinuity detection is heuristic; a detected gap is not proof of its cause.'
					]
				}
			};
		}
		if (name !== 'summarize_window') throw new Error(`Unknown tool: ${name}`);
		if (Object.keys(input).some((key) => !['startSec', 'endSec', 'slots'].includes(key)))
			throw new Error('Unknown window argument.');
		const { startSec, endSec } = input;
		if (
			typeof startSec !== 'number' ||
			typeof endSec !== 'number' ||
			!Number.isFinite(startSec) ||
			!Number.isFinite(endSec) ||
			startSec > endSec
		)
			throw new Error('Finite, ordered startSec and endSec are required.');
		if (
			!Array.isArray(input.slots) ||
			input.slots.length < 1 ||
			input.slots.length > 8 ||
			new Set(input.slots).size !== input.slots.length ||
			input.slots.some((slot) => !slots.includes(slot))
		)
			throw new Error('Select 1–8 unique known channel slots.');
		if (!time.values) throw new Error(time.reason!);
		const rows: number[] = [];
		let invalidTimeCount = 0;
		for (let row = 0; row < time.values.length; row++) {
			const value = time.values[row];
			if (!Number.isFinite(value)) invalidTimeCount++;
			else if (value >= startSec && value <= endSec) rows.push(row);
		}
		const statistics = (input.slots as ChannelSlot[]).map((slot) => {
			const resolution = mapping.resolve(slot, session);
			let count = 0,
				mean = 0,
				min = Infinity,
				max = -Infinity;
			if (resolution.status === 'resolved') {
				const values = session.findChannel(resolution.channelName)!.values;
				for (const row of rows) {
					const value = values[row] * resolution.scale + resolution.offset;
					if (!Number.isFinite(value)) continue;
					count++;
					mean = mean * ((count - 1) / count) + value / count;
					min = Math.min(min, value);
					max = Math.max(max, value);
				}
			}
			return {
				slot,
				resolution: resolution as JsonValue,
				validCount: count,
				unavailableCount: rows.length - count,
				min: count ? min : null,
				max: count ? max : null,
				mean: count && Number.isFinite(mean) ? mean : null
			};
		});
		return {
			ok: true,
			data: {
				contextId: context.id,
				startSec,
				endSec,
				sampleCount: rows.length,
				firstRowIndex: rows[0] ?? null,
				lastRowIndex: rows.at(-1) ?? null,
				excludedInvalidTimeCount: invalidTimeCount,
				statistics,
				limitations: [
					'Bounds are inclusive parsed times. Row indices are zero-based parsed samples, not original file lines.',
					'Statistics do not imply steady-state or tuning eligibility.'
				]
			}
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Tool execution failed.' };
	}
}
