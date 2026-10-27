import type { Annotation } from '#lib/shared/types/logSession.ts';
import { Channel } from '../core/Channel';
import { LogSession } from '../core/LogSession';

export class MegasquirtCsvParser {
	private fixFirstRowTimeAnomaly(timeValues: number[]): void {
		if (timeValues.length < 3) return;
		const delta01 = Math.abs(timeValues[1] - timeValues[0]);
		const delta12 = Math.abs(timeValues[2] - timeValues[1]);
		if (delta12 < 1e-9) return;
		if (delta01 > delta12 * 10.0) {
			timeValues[0] = timeValues[1] - delta12;
		}
	}

	private tryParseBoolean(token: string): { success: boolean; val: number } {
		const lower = token.toLowerCase();
		if (lower === 'true' || lower === 'yes' || lower === 'on') return { success: true, val: 1.0 };
		if (lower === 'false' || lower === 'no' || lower === 'off') return { success: true, val: 0.0 };
		return { success: false, val: 0.0 };
	}

	parse(
		content: string,
		sourcePath: string = 'memory.msl',
		onProgress?: (ratio: number) => void
	): { session: LogSession | null; error?: string } {
		if (!content || content.length === 0) {
			return { session: null, error: 'File content is empty.' };
		}

		const lines = content.split(/\r?\n/);
		let formatInfo = '';
		let captureDate = '';
		let headerTokens: string[] = [];
		let lineIdx = 0;

		// 1. Scan metadata & locate header line
		for (; lineIdx < lines.length; ++lineIdx) {
			const line = lines[lineIdx].trim();
			if (!line) continue;

			if (line.startsWith('"')) {
				let text = line;
				if (text.length >= 2 && text.endsWith('"')) {
					text = text.slice(1, -1);
				}
				if (text.startsWith('Capture Date:')) {
					captureDate = text;
				} else if (!formatInfo) {
					formatInfo = text;
				}
				continue;
			}

			if (line === '#') continue;

			headerTokens = line.split('\t').map((s) => s.trim());
			lineIdx++;
			break;
		}

		if (headerTokens.length === 0) {
			return { session: null, error: 'Could not find header row in MSL file.' };
		}

		if (lineIdx >= lines.length) {
			return { session: null, error: 'File ended after header row (missing units row).' };
		}

		// 2. Units Row
		const unitTokens = lines[lineIdx].split('\t').map((s) => s.trim());
		lineIdx++;

		const columnCount = headerTokens.length;
		const channels: Channel[] = [];
		let timeChannelIndex = -1;

		for (let i = 0; i < columnCount; ++i) {
			const name = headerTokens[i];
			const unit = i < unitTokens.length ? unitTokens[i] : '';
			const ch = new Channel(name, unit);

			if (name === 'Time') {
				timeChannelIndex = i;
			} else if (name === 'DateTime' || name === 'Timestamp') {
				ch.setIsTimestamp(true);
			}
			channels.push(ch);
		}

		const sawNumeric = new Uint8Array(columnCount);
		const sawBoolean = new Uint8Array(columnCount);
		const annotations: Annotation[] = [];
		let rowCount = 0;

		const totalLines = lines.length;

		// 3. Parse Data Rows
		for (; lineIdx < totalLines; ++lineIdx) {
			const rawLine = lines[lineIdx];
			const line = rawLine.trim();
			if (!line) continue;

			if (line.startsWith('MARK')) {
				let markTime = 0.0;
				if (timeChannelIndex >= 0 && channels[timeChannelIndex].values.length > 0) {
					const vals = channels[timeChannelIndex].values;
					markTime = vals[vals.length - 1];
				}
				if (annotations.length === 0 || annotations[annotations.length - 1].timeSec !== markTime) {
					annotations.push({
						timeSec: markTime,
						label: line,
						color: 'rgba(255, 178, 51, 1.0)'
					});
				}
				continue;
			}

			if (onProgress && rowCount % 1000 === 0) {
				onProgress(Math.min(1.0, lineIdx / totalLines));
			}

			// Preserve edge tabs: empty first/last cells are missing values, not missing columns.
			const tokens = rawLine.split('\t');
			if (tokens.length !== columnCount) {
				// Discard mismatched row
				continue;
			}

			for (let c = 0; c < columnCount; ++c) {
				const token = tokens[c].trim();
				let val = NaN;

				if (channels[c].isTimestamp) {
					const parsedEpoch = Date.parse(token);
					if (!isNaN(parsedEpoch)) {
						val = parsedEpoch / 1000.0;
						sawNumeric[c] = 1;
					} else {
						channels[c].setIsNumeric(false);
					}
				} else {
					const num = Number(token);
					if (token !== '' && !isNaN(num)) {
						val = num;
						sawNumeric[c] = 1;
					} else if (token !== '') {
						const boolCheck = this.tryParseBoolean(token);
						if (boolCheck.success) {
							val = boolCheck.val;
							sawBoolean[c] = 1;
						} else {
							channels[c].setIsNumeric(false);
						}
					}
				}

				channels[c].values.push(val);
			}
			rowCount++;
		}

		if (onProgress) onProgress(1.0);

		for (let i = 0; i < columnCount; ++i) {
			channels[i].setIsBoolean(sawBoolean[i] === 1 && sawNumeric[i] === 0);
		}

		if (timeChannelIndex >= 0) {
			this.fixFirstRowTimeAnomaly(channels[timeChannelIndex].values);
		}

		const session = new LogSession();
		session.sourcePath = sourcePath;
		session.formatInfo = formatInfo;
		session.captureDate = captureDate;
		session.rowCount = rowCount;

		for (const ch of channels) {
			session.addChannel(ch);
		}

		if (timeChannelIndex >= 0) {
			session.setTimeChannelIndex(timeChannelIndex);
		}

		session.setAnnotations(annotations);
		session.channelMapping.autoDetect(session);
		session.scanIntegrityAndBuildDiscontinuities();

		return { session };
	}
}
