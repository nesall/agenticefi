import { eligibilityConfig } from '../analysis/sampleEligibility';
import { experimentalConfig } from '../analysis/sampleEligibilityV2';
import { vePreparationConfig, type VeEligibilityProfile } from '../analysis/prepareVeEvaluation';
import { veFitConfig } from '../analysis/fitVeCorrections';
import { freezeVeArtifact } from '../analysis/veArtifacts';
import type { VePreparationConfig, Immutable } from '../../shared/types/veEvaluation';
import type { VeFitConfig } from '../../shared/types/veFitting';

export const ANALYTICAL_LIMITS = Object.freeze({
	maxLogBytes: 64 * 1024 * 1024,
	maxRows: 60000,
	maxChannels: 300,
	maxCells: 256,
	maxTrainingEpisodes: 64,
	maxSupportedCells: 32,
	maxArtifactBytes: 128 * 1024 * 1024,
	maxResponseBytes: 32000,
	jobTimeoutMs: 120000,
	retentionMs: 120000
});
export type AnalyticalLimits = { -readonly [K in keyof typeof ANALYTICAL_LIMITS]: number };
export type AnalyticalInput = {
	contextId: string;
	logName: string;
	logContent: string;
	calibrationId: string;
	/** Explicitly confirmed RPM / MAP kPa / AFR semantics. Never inferred from names. */
	calibrationSemantics?: 'rpm-map-kpa-afr';
	veXml?: string;
	afrXml?: string;
	profile?: VeEligibilityProfile;
	preparation?: Partial<VePreparationConfig>;
	fitting?: Partial<VeFitConfig>;
	limits?: Partial<AnalyticalLimits>;
	/** Caller-only old-generation heap budget. Large logs may require the explicit 1 GiB tier. */
	workerHeapMb?: 512 | 1024;
};
export type AnalyticalSettings = Immutable<{
	workerHeapMb: 512 | 1024;
	profile: VeEligibilityProfile;
	preparation: VePreparationConfig;
	fitting: VeFitConfig;
	limits: AnalyticalLimits;
}>;
export type AnalyticalSnapshot = {
	contextId: string;
	logName: string;
	logContent: string;
	calibrationId: string;
	calibrationSemantics?: 'rpm-map-kpa-afr';
	veXml?: string;
	afrXml?: string;
	settings: AnalyticalSettings;
};

export function analyticalSnapshot(input: AnalyticalInput): AnalyticalSnapshot {
	const workerHeapMb = input.workerHeapMb ?? 512;
	if (![512, 1024].includes(workerHeapMb))
		throw new Error('Analytical worker heap must be 512 or 1024 MiB.');
	for (const key of ['contextId', 'logName', 'calibrationId'] as const)
		if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 160)
			throw new Error(`Invalid ${key}.`);
	if (input.calibrationSemantics !== undefined && input.calibrationSemantics !== 'rpm-map-kpa-afr')
		throw new Error('Unsupported calibration semantics.');
	const limits: AnalyticalLimits = { ...ANALYTICAL_LIMITS };
	if (input.limits) {
		for (const [key, value] of Object.entries(input.limits)) {
			if (
				!Object.hasOwn(limits, key) ||
				!Number.isSafeInteger(value) ||
				value! <= 0 ||
				value! > ANALYTICAL_LIMITS[key as keyof AnalyticalLimits]
			)
				throw new Error(`Invalid analytical resource bound: ${key}`);
			limits[key as keyof AnalyticalLimits] = value!;
		}
	}
	if (
		typeof input.logContent !== 'string' ||
		!input.logContent.length ||
		Buffer.byteLength(input.logContent) > limits.maxLogBytes
	)
		throw new Error('Log exceeds analytical input byte budget or is empty.');
	for (const key of ['veXml', 'afrXml'] as const)
		if (
			input[key] !== undefined &&
			(typeof input[key] !== 'string' ||
				Buffer.byteLength(input[key]) > 65536 ||
				!input[key].trim())
		)
			throw new Error(`Invalid/oversized ${key}.`);
	const profile = input.profile ?? { version: 'steady-afr-ve-v1' as const };
	if (limits.maxResponseBytes < 1024)
		throw new Error(
			'Analytical response budget must allow at least 1024 bytes for bounded errors.'
		);
	if (!profile || !['steady-afr-ve-v1', 'steady-afr-ve-v2-experimental'].includes(profile.version))
		throw new Error('Invalid analytical eligibility profile.');
	const allowedProfileKeys =
		profile.version === 'steady-afr-ve-v1'
			? ['version', 'config']
			: ['version', 'config', 'baseConfig'];
	if (Object.keys(profile).some((key) => !allowedProfileKeys.includes(key)))
		throw new Error('Unknown analytical profile property.');
	const frozenProfile =
		profile.version === 'steady-afr-ve-v1'
			? { version: profile.version, config: eligibilityConfig(profile.config) }
			: {
					version: profile.version,
					config: experimentalConfig(profile.config),
					baseConfig: eligibilityConfig(profile.baseConfig)
				};
	const preparation = vePreparationConfig(input.preparation),
		fitting = veFitConfig(input.fitting);
	if (fitting.maxIterations > 5000)
		throw new Error(
			'Analytical fitting iteration ceiling is 5000; settings are rejected, never reduced.'
		);
	return freezeVeArtifact({
		contextId: input.contextId,
		logName: input.logName,
		logContent: input.logContent,
		calibrationId: input.calibrationId,
		...(input.veXml === undefined ? {} : { veXml: input.veXml }),
		...(input.afrXml === undefined ? {} : { afrXml: input.afrXml }),
		...(input.calibrationSemantics === undefined
			? {}
			: { calibrationSemantics: input.calibrationSemantics }),
		settings: { profile: frozenProfile, preparation, fitting, limits, workerHeapMb }
	});
}
