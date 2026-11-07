const { readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

// Commands des utility-bots (sb-v2-Code, Prefix "!") statisch aus den Quelldateien lesen - fuer die Regel, dass "!"
// in seinen Channels ihm gehoert, und fuer !botcommands. Bewusst kein require(): das wuerde sb-v2-Startcode ausfuehren.

const stringField = (source, field) => {
	const match = new RegExp(`\\b${field}\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|"((?:\\\\.|[^"\\\\])*)"|\`([^\`]*)\`)`).exec(source);
	if (!match) {
		return null;
	}
	return (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(['"\\])/g, '$1');
};

const arrayField = (source, field) => {
	const match = new RegExp(`\\b${field}\\s*:\\s*\\[([^\\]]*)\\]`).exec(source);
	return match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((i) => i[1]) : [];
};

/** Name/Aliases/Permission/Description/Usage/Flags aus einer sb-v2-Command-Datei */
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
		name: name.toLowerCase(),
		aliases: arrayField(body, 'Aliases').map((i) => i.toLowerCase()),
		description: stringField(body, 'Description'),
		usage: stringField(body, 'Usage'),
		permission: permission === 'owner' || permission === 'mod' ? permission : 'everyone',
		noPrefix: arrayField(body, 'Flags').includes('no-prefix'),
	};
};

const REEXPORT_REGEX = /require\(\s*['"]((?:\.\.\/)+v2\/commands\/[a-z0-9-]+)['"]\s*\)/;

const loadOtherBotCommands = (dir) => {
	let entries;
	try {
		entries = readdirSync(dir);
	}
	catch {
		return [];
	}

	const result = [];
	for (const entry of entries) {
		let source;
		try {
			source = readFileSync(join(dir, entry, 'index.ts'), 'utf8');
			const reexport = REEXPORT_REGEX.exec(source);
			if (reexport) {
				source = readFileSync(resolve(dir, entry, reexport[1], 'index.ts'), 'utf8');
			}
		}
		catch {
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
/** Namen und Aliase der "!"-Commands des utility-bots, einmal gelesen; vstop ist dort utility-only */
const getUtilityInvocations = (dir) => {
	if (!utilityInvocations) {
		const list = dir ? loadOtherBotCommands(dir) : [];
		utilityInvocations = new Set(['vstop', 'vsalltop', 'vstopall', ...list.flatMap((i) => [i.name, ...i.aliases])]);
	}
	return utilityInvocations;
};

module.exports = { parseLegacyCommandSource, loadOtherBotCommands, getUtilityInvocations };
