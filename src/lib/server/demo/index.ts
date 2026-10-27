import logContent from './rx7.msl?raw';
import veXml from './ve.table?raw';
import afrXml from './afr.table?raw';
import { createInvestigationContext } from '../investigation/context';

/** Server-bundled assets, independent of test fixtures or the deployment cwd.
 * The original Windows-1252 log is stored here as losslessly transcoded UTF-8.
 * Calibration association was confirmed by the owner of the block1 dataset.
 */
export function loadDemo(id: string) {
	return createInvestigationContext({
		id,
		logName: '2025-04-12_16.16.28.msl',
		calibrationId: 'block1-calibration',
		logContent,
		logEncoding: 'utf-8',
		veXml,
		afrXml
	});
}
