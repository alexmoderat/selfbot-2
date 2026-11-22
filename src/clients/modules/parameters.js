// "name:wert"-Parameter aus den Command-Argumenten (wie Supibots parseParametersFromArguments).
// Anfuehrungszeichen fuer Werte mit Leerzeichen: name:"zwei Woerter". Alles nach "--" wird nicht mehr gelesen.
// Typen: "string" | "number" | "boolean" | "regex"

const IGNORE_PARAMETERS_DELIMITER = '--';
const LINEAR_REGEX_FLAG = '--enable-experimental-regexp-engine';

/**
 * "/body/flags" oder nackter Body. Mit dem V8-Flag laufen Nutzer-Regexes in der linearen Engine ("l"), damit boese
 * Muster den Bot nicht lahmlegen; "i" ist dort nicht erlaubt und wird durch [aA]-Gruppen ersetzt.
 */
const parseRegex = (value, linear = process.execArgv.includes(LINEAR_REGEX_FLAG)) => {
	const string = value.replaceAll(/^\/|\/$/g, '');
	const lastSlashIndex = string.match(/(?<!\\)(\/)(?!.*\/)/)?.index ?? -1;
	const body = lastSlashIndex !== -1 ? string.slice(0, lastSlashIndex) : string;
	let flags = lastSlashIndex !== -1 ? string.slice(lastSlashIndex + 1) : '';

	try {
		let source = new RegExp(body, flags).source;
		if (!linear) {
			return new RegExp(source, flags);
		}
		if (flags.includes('i')) {
			source = source.replaceAll(/(?<!\\)([a-z])/gi, (_total, match) => `[${match.toLowerCase()}${match.toUpperCase()}]`);
			flags = flags.replace('i', '');
		}
		return new RegExp(source, `${flags}l`);
	} catch {
		return null;
	}
};

const parseValue = (type, value) => {
	if (type === 'string') {
		return value;
	} else if (type === 'regex') {
		return parseRegex(value);
	} else if (type === 'number') {
		const number = Number(value);
		return value !== '' && Number.isFinite(number) ? number : null;
	} else if (value === 'true') {
		return true;
	} else if (value === 'false') {
		return false;
	}
	return null;
};

/** @returns {{ success: true, args: string[], parameters: object } | { success: false, reply: string }} */
const parseParametersFromArguments = (definitions, argsInput) => {
	const names = new Map(definitions.map((i) => [i.name, i]));
	const parameters = {};
	const args = [];

	let ignoring = false;
	for (let i = 0; i < argsInput.length; i++) {
		const token = argsInput[i];
		if (ignoring) {
			args.push(token);
			continue;
		} else if (token === IGNORE_PARAMETERS_DELIMITER) {
			ignoring = true;
			continue;
		}

		const colonIndex = token.indexOf(':');
		const name = colonIndex > 0 ? token.slice(0, colonIndex) : null;
		const definition = name ? names.get(name) : undefined;
		if (!name || !definition) {
			args.push(token);
			continue;
		}

		let rawValue = token.slice(colonIndex + 1);
		if (rawValue.startsWith('"')) {
			// Wert in Anfuehrungszeichen, ggf. ueber mehrere Tokens
			const parts = [rawValue.slice(1)];
			let closed = rawValue.length > 1 && rawValue.endsWith('"');
			if (closed) {
				parts[0] = parts[0].slice(0, -1);
			}
			while (!closed && i + 1 < argsInput.length) {
				i++;
				const next = argsInput[i];
				if (next.endsWith('"')) {
					parts.push(next.slice(0, -1));
					closed = true;
				} else {
					parts.push(next);
				}
			}
			if (!closed) {
				return { success: false, reply: `Unclosed quote in parameter "${name}"!` };
			}
			rawValue = parts.join(' ');
		}

		const value = parseValue(definition.type, rawValue);
		if (value === null) {
			return { success: false, reply: `Could not parse parameter "${name}" as ${definition.type}!` };
		}
		parameters[name] = value;
	}

	return { success: true, args, parameters };
};

/** Geparste Parameter zurueck in "name:wert" - fuer den Bestaetigungshinweis */
const formatParams = (params) =>
	Object.entries(params)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => {
			const text = value instanceof Date ? value.toISOString() : String(value);
			return `${key}:${/\s/.test(text) ? `"${text}"` : text}`;
		});

module.exports = { IGNORE_PARAMETERS_DELIMITER, parseRegex, parseParametersFromArguments, formatParams };
