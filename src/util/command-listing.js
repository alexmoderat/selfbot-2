const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

// Hilfen fuer !commands, !how und !botcommands

/** "sb" -> "sb ", "?" -> "?" (Wortprefixe brauchen ein Leerzeichen, Zeichenprefixe nicht) */
const spacePrefix = (prefix) => (/^[a-z0-9]/i.test(prefix) ? `${prefix} ` : prefix);

/** So tippt man den Command tatsaechlich: no-prefix-Commands mit "!", sonst mit dem Haupt-Prefix */
const invocationPrefix = (command, prefix) => (command.noPrefix ? '!' : spacePrefix(prefix));

/** Usage-Zeile mit Prefix; Usages, die schon mit "!" anfangen, bleiben unveraendert (wie sb-v2) */
const formatUsage = (command, prefix) => {
	if (!command.Usage) {
		return null;
	}

	return command.Usage.startsWith('!') ? command.Usage : `${invocationPrefix(command, prefix)}${command.Usage}`;
};

const stringField = (source, field) => {
	const match = new RegExp(`\\b${field}\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|"((?:\\\\.|[^"\\\\])*)"|\`([^\`]*)\`)`).exec(source);
	if (!match) {
		return null;
	}

	const raw = match[1] ?? match[2] ?? match[3] ?? '';
	return raw.replace(/\\(['"\\])/g, '$1');
};

const arrayField = (source, field) => {
	const match = new RegExp(`\\b${field}\\s*:\\s*\\[([^\\]]*)\\]`).exec(source);
	if (!match) {
		return [];
	}

	return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((i) => i[1]);
};

/**
 * Liest Name/Aliases/Permission/Description/Usage/Flags statisch aus einer sb-v2-Command-Datei.
 * Bewusst kein require(): das wuerde Startcode von sb-v2 (DB-Verbindungen, Timer) im selfbot-Prozess ausfuehren.
 */
const parseLegacyCommandSource = (source) => {
	const declareIndex = source.indexOf('declare(');
	if (declareIndex === -1) {
		return null;
	}

	const body = source.slice(declareIndex);
	const name = stringField(body, 'Name');
	if (!name) {
		return null;
	}

	const permission = stringField(body, 'Permission');
	return {
		Name: name.toLowerCase(),
		Aliases: arrayField(body, 'Aliases').map((i) => i.toLowerCase()),
		Description: stringField(body, 'Description'),
		Usage: stringField(body, 'Usage'),
		permission: permission === 'owner' || permission === 'mod' ? permission : 'everyone',
		noPrefix: arrayField(body, 'Flags').includes('no-prefix'),
	};
};

const REEXPORT_REGEX = /require\(\s*['"]((?:\.\.\/)+v2\/commands\/[a-z0-9-]+)['"]\s*\)/;

/** Commands des utility-bots (src/commands), Weiterleitungen auf v2/commands werden aufgeloest */
const loadOtherBotCommands = (dir) => {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}

	const result = [];
	for (const entry of entries) {
		const file = join(dir, entry, 'index.ts');
		let source;
		try {
			source = readFileSync(file, 'utf8');
			const reexport = REEXPORT_REGEX.exec(source);
			if (reexport) {
				source = readFileSync(resolve(dir, entry, reexport[1], 'index.ts'), 'utf8');
			}
		} catch {
			continue;
		}

		const parsed = parseLegacyCommandSource(source);
		if (parsed) {
			result.push(parsed);
		}
	}

	return result;
};

let utilityInvocations = null;
/**
 * Namen und Aliase der "!"-Commands, die in den utility-Channels der utility-Bot beantwortet, einmal gelesen.
 * Mit `explicit` (config values.utilityCommands, Namen und Aliase von utility-next) genau diese Liste; ohne die Commands des alten
 * utility-bots aus `dir` (sb-v2-Code), dort ist vstop (+ vsalltop, vstopall) utility-only.
 */
const getUtilityInvocations = (dir, explicit = null) => {
	if (!utilityInvocations) {
		if (Array.isArray(explicit) && explicit.length > 0) {
			utilityInvocations = new Set(explicit.map((name) => name.toLowerCase()));
		} else {
			const list = dir ? loadOtherBotCommands(dir) : [];
			utilityInvocations = new Set(['vstop', 'vsalltop', 'vstopall', ...list.flatMap((i) => [i.Name, ...i.Aliases].map((name) => name.toLowerCase()))]);
		}
	}
	return utilityInvocations;
};

module.exports = { spacePrefix, invocationPrefix, formatUsage, parseLegacyCommandSource, loadOtherBotCommands, getUtilityInvocations };
