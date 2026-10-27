export type MslEncoding = 'utf-8' | 'windows-1252';

/** Try UTF-8 without silently replacing invalid bytes. Legacy MegaSquirt logs
 * use single-byte degree symbols; Windows-1252 is an explicit fallback assumption,
 * not proof of the source's original encoding.
 */
export function decodeMsl(bytes: Uint8Array): {
	content: string;
	encoding: MslEncoding;
	usedFallback: boolean;
} {
	try {
		return {
			content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
			encoding: 'utf-8',
			usedFallback: false
		};
	} catch {
		return {
			content: new TextDecoder('windows-1252').decode(bytes),
			encoding: 'windows-1252',
			usedFallback: true
		};
	}
}
