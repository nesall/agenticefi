import { Table2D } from '#lib/server/core/Table2D.ts';

export interface TunerStudioTableMetadata {
	table: Table2D;
	xAxisName: string;
	yAxisName: string;
	author?: string;
	writeDate?: string;
}

type XmlElement = {
	name: string;
	uri: string;
	attributes: Map<string, string>;
	children: XmlElement[];
	text: string;
};

const tableNamespace = 'http://www.EFIAnalytics.com/:table';
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
const namePattern = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/;
const fail = (message: string): never => {
	throw new Error(`Invalid TunerStudio XML: ${message}`);
};

function isXmlCharacter(code: number): boolean {
	return (
		code === 9 ||
		code === 10 ||
		code === 13 ||
		(code >= 0x20 && code <= 0xd7ff) ||
		(code >= 0xe000 && code <= 0xfffd) ||
		(code >= 0x10000 && code <= 0x10ffff)
	);
}

function decodeEntities(text: string): string {
	const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
	return text.replace(/&([^;]*);|&/g, (match, entity: string | undefined) => {
		if (entity && Object.hasOwn(named, entity)) return named[entity];
		if (entity && /^(?:#[0-9]+|#x[0-9a-fA-F]+)$/.test(entity)) {
			const code = entity.startsWith('#x')
				? parseInt(entity.slice(2), 16)
				: Number(entity.slice(1));
			if (isXmlCharacter(code)) return String.fromCodePoint(code);
		}
		return fail(`unknown or invalid entity ${match}`);
	});
}

/** Strict reader for the XML subset used by .table exports. DTDs and processing
 * instructions other than the XML declaration are deliberately unsupported.
 * Parsing is stack-based; regexes only recognize individual names/tokens.
 */
function readXml(input: string): XmlElement {
	const xml = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	for (const char of xml) if (!isXmlCharacter(char.codePointAt(0)!)) fail('invalid XML character');
	let position = 0;
	let root: XmlElement | undefined;
	const stack: { element: XmlElement; qualifiedName: string; namespaces: Map<string, string> }[] =
		[];
	const skipSpace = () => {
		const start = position;
		while (/[\t\n\r ]/.test(xml[position] ?? '') && position < xml.length) position++;
		return position > start;
	};
	const readName = () => {
		const match = namePattern.exec(xml.slice(position));
		if (!match) return fail(`expected element or attribute name at ${position}`);
		position += match[0].length;
		return match[0];
	};
	const expanded = (name: string, namespaces: Map<string, string>, attribute = false) => {
		const parts = name.split(':');
		const prefix = parts.length === 2 ? parts[0] : '';
		if (prefix && !namespaces.get(prefix)) fail(`undeclared namespace prefix ${prefix}`);
		return { name: parts.at(-1)!, uri: attribute && !prefix ? '' : (namespaces.get(prefix) ?? '') };
	};
	if (/^<\?xml[\t\n\r ]/.test(xml)) {
		const declaration =
			/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>/.exec(
				xml
			);
		if (!declaration) fail('invalid XML declaration');
		position = declaration![0].length;
	}
	while (position < xml.length) {
		const current = stack.at(-1);
		if (xml.startsWith('<!--', position)) {
			const end = xml.indexOf('-->', position + 4);
			if (end < 0 || xml.slice(position + 4, end).includes('--') || xml[end - 1] === '-')
				fail('invalid comment');
			position = end + 3;
		} else if (xml.startsWith('<![CDATA[', position)) {
			const end = xml.indexOf(']]>', position + 9);
			if (!current || end < 0) fail('invalid CDATA section');
			current!.element.text += xml.slice(position + 9, end);
			position = end + 3;
		} else if (xml.startsWith('</', position)) {
			position += 2;
			const name = readName();
			skipSpace();
			if (xml[position++] !== '>' || !current || current.qualifiedName !== name)
				fail('mismatched closing tag');
			stack.pop();
		} else if (xml.startsWith('<!', position) || xml.startsWith('<?', position)) {
			fail('DTDs and processing instructions are unsupported');
		} else if (xml[position] === '<') {
			position++;
			const qualifiedName = readName();
			const attributes = new Map<string, string>();
			while (true) {
				const spaced = skipSpace();
				if (xml[position] === '>' || xml.startsWith('/>', position)) break;
				if (!spaced) fail('attributes must be separated by whitespace');
				const name = readName();
				if (attributes.has(name)) fail(`duplicate attribute ${name}`);
				skipSpace();
				if (xml[position++] !== '=') fail('expected attribute equals sign');
				skipSpace();
				const quote = xml[position++];
				if (quote !== '"' && quote !== "'") fail('attribute must be quoted');
				const end = xml.indexOf(quote, position);
				if (end < 0 || xml.slice(position, end).includes('<')) fail('invalid attribute value');
				attributes.set(name, decodeEntities(xml.slice(position, end).replace(/[\t\n]/g, ' ')));
				position = end + 1;
			}
			const namespaces = new Map(current?.namespaces ?? [['xml', xmlNamespace]]);
			for (const [name, value] of attributes) {
				if (name === 'xmlns' || name.startsWith('xmlns:')) {
					const prefix = name === 'xmlns' ? '' : name.slice(6);
					if (
						prefix === 'xmlns' ||
						value === 'http://www.w3.org/2000/xmlns/' ||
						(prefix === 'xml' ? value !== xmlNamespace : value === xmlNamespace) ||
						(prefix && !value)
					)
						fail('invalid namespace declaration');
					namespaces.set(prefix, value);
				}
			}
			if (qualifiedName.startsWith('xmlns:')) fail('reserved element prefix');
			const resolved = expanded(qualifiedName, namespaces);
			const expandedAttributes = new Set<string>();
			for (const name of attributes.keys()) {
				if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
				const attr = expanded(name, namespaces, true);
				const key = `${attr.uri}|${attr.name}`;
				if (expandedAttributes.has(key)) fail('duplicate expanded attribute');
				expandedAttributes.add(key);
			}
			const element: XmlElement = { ...resolved, attributes, text: '', children: [] };
			if (current) current.element.children.push(element);
			else if (root) fail('multiple root elements');
			else root = element;
			if (xml.startsWith('/>', position)) position += 2;
			else {
				position++;
				stack.push({ element, qualifiedName, namespaces });
			}
		} else {
			const next = xml.indexOf('<', position);
			const end = next < 0 ? xml.length : next;
			const text = xml.slice(position, end);
			if (text.includes(']]>')) fail('CDATA terminator outside CDATA');
			if (!current && text.trim()) fail('text outside root element');
			const decoded = decodeEntities(text);
			if (current) current.element.text += decoded;
			position = end;
		}
	}
	if (!root || stack.length) return fail('missing root or unclosed element');
	return root;
}

/** Import a TunerStudio .table export; values are load rows by RPM columns. */
export function importTunerStudioXml(xmlContent: string): TunerStudioTableMetadata {
	const root = readXml(xmlContent);
	if (root.name !== 'tableData' || (root.uri !== tableNamespace && root.uri !== ''))
		fail('unexpected root or namespace');
	const child = (parent: XmlElement, name: string, required = true): XmlElement | undefined => {
		const matches = parent.children.filter(
			(element) => element.name === name && element.uri === root.uri
		);
		if (matches.length > 1 || (required && matches.length !== 1))
			fail(`expected exactly one ${name}`);
		return matches[0];
	};
	const tableElement = child(root, 'table')!;
	const xElement = child(tableElement, 'xAxis')!;
	const yElement = child(tableElement, 'yAxis')!;
	const zElement = child(tableElement, 'zValues')!;
	const numbers = (element: XmlElement): number[] => {
		if (element.children.length || !element.text.trim())
			return fail(`${element.name} must contain numeric text`);
		return element.text
			.trim()
			.split(/\s+/)
			.map((token, index) => {
				if (
					!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) ||
					!Number.isFinite(Number(token))
				) {
					return fail(
						`${element.name} token ${index + 1} is not a finite decimal number: ${token}`
					);
				}
				return Number(token);
			});
	};
	const dimension = (element: XmlElement, name: string): number => {
		const value = element.attributes.get(name);
		if (
			!value ||
			!/^\d+$/.test(value) ||
			!Number.isSafeInteger(Number(value)) ||
			Number(value) <= 0
		)
			return fail(`${element.name}.${name} must be a positive integer`);
		return Number(value);
	};
	const x = numbers(xElement),
		y = numbers(yElement),
		z = numbers(zElement);
	const cols = dimension(tableElement, 'cols'),
		rows = dimension(tableElement, 'rows');
	if (
		dimension(xElement, 'cols') !== cols ||
		dimension(yElement, 'rows') !== rows ||
		dimension(zElement, 'cols') !== cols ||
		dimension(zElement, 'rows') !== rows ||
		x.length !== cols ||
		y.length !== rows ||
		z.length !== rows * cols
	)
		fail('declared dimensions do not match axes and cell count');
	const table = new Table2D(x, y);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) table.setValue(row, col, z[row * cols + col]);
	}
	const bibliography = child(root, 'bibliography', false);
	return {
		table,
		xAxisName: xElement.attributes.get('name') || 'x',
		yAxisName: yElement.attributes.get('name') || 'y',
		author: bibliography?.attributes.get('author') || undefined,
		writeDate: bibliography?.attributes.get('writeDate') || undefined
	};
}
