import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { MegasquirtCsvParser } from '../msl/MegasquirtCsvParser';
import { importTunerStudioXml } from '../msl/importTunerStudioXml';
import { decodeMsl, type MslEncoding } from '../msl/decodeMsl';
import type { LogSession } from '../core/LogSession';
import type { TunerStudioTableMetadata } from '../msl/importTunerStudioXml';
import type { EligibilityConfig } from '../../shared/types/sampleEligibility';
import { eligibilityConfig } from '../analysis/sampleEligibility';

export type InvestigationContext = {
	id: string;
	logName: string;
	logEncoding: MslEncoding | 'provided-string';
	calibrationId: string;
	session: LogSession;
	ve: TunerStudioTableMetadata;
	afr: TunerStudioTableMetadata;
	limitations: string[];
	eligibilityProfile: EligibilityConfig;
};

/** Association is explicitly supplied by the caller, never inferred from dates. */
export function createInvestigationContext(input: {
	id: string;
	logName: string;
	logContent: string;
	logEncoding?: MslEncoding;
	calibrationId: string;
	veXml: string;
	afrXml: string;
	eligibilityProfile?: Partial<EligibilityConfig>;
}): InvestigationContext {
	if (!input.id.trim() || !input.calibrationId.trim())
		throw new Error('Context and calibration IDs are required.');
	const { session, error } = new MegasquirtCsvParser().parse(input.logContent, input.logName);
	if (!session || !session.rowCount) throw new Error(error ?? 'Log contains no samples.');
	if (session.channels.some((channel) => channel.values.length !== session.rowCount))
		throw new Error('Log channels are not aligned.');
	return {
		id: input.id,
		logName: basename(input.logName),
		logEncoding: input.logEncoding ?? 'provided-string',
		calibrationId: input.calibrationId,
		session,
		eligibilityProfile: eligibilityConfig(input.eligibilityProfile),
		ve: importTunerStudioXml(input.veXml),
		afr: importTunerStudioXml(input.afrXml),
		limitations: [
			...(input.logEncoding === 'windows-1252'
				? ['The log was not valid UTF-8; Windows-1252 was used as a fallback encoding assumption.']
				: []),
			'Calibration association is supplied by the caller.',
			'The log parser can skip malformed rows and correct the first timestamp; original-row diagnostics are not yet available.',
			'Summary statistics do not establish steady-state eligibility. The eligibility tool applies a configurable screening profile, not a validated tuning guarantee or VE correction.'
		]
	};
}

export async function loadInvestigationFiles(input: {
	id: string;
	calibrationId: string;
	logPath: string;
	vePath: string;
	afrPath: string;
	eligibilityProfile?: Partial<EligibilityConfig>;
}): Promise<InvestigationContext> {
	const [logBytes, veXml, afrXml] = await Promise.all([
		readFile(input.logPath),
		readFile(input.vePath, 'utf8'),
		readFile(input.afrPath, 'utf8')
	]);
	const decoded = decodeMsl(logBytes);
	return createInvestigationContext({
		...input,
		logName: input.logPath,
		logContent: decoded.content,
		logEncoding: decoded.encoding,
		veXml,
		afrXml
	});
}
