const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const { parseLegacyCommandSource } = require('./command-listing.js');

/**
 * Supibot-Commands, die dieser Bot (noch) nicht hat - fuer den Link "Commands only working with Supibot" im Dashboard
 * (ninou2, 07.11.2026: "add ( commands only working with supibot ) and make it clickable that show this page").
 * Statisch aus dem Supibot-Checkout gelesen, wie die utility-bot-Commands in command-listing.ts.
 */
const SUPIBOT_COMMANDS_DIR = '/root/supibot/commands';

const loadSupibotCommands = (dir = SUPIBOT_COMMANDS_DIR) => {
	if (!existsSync(dir)) {
		return [];
	}

	const list = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const file = join(dir, entry.name, 'index.ts');
		if (!entry.isDirectory() || !existsSync(file)) {
			continue;
		}

		const parsed = parseLegacyCommandSource(readFileSync(file, 'utf8'));
		if (parsed) {
			list.push(parsed);
		}
	}

	return list;
};

/** Supibot-Commands, deren Name weder Name noch Alias eines eigenen Commands ist, alphabetisch */
const supibotOnly = (supibot, own) => {
	const known = new Set(own.flatMap((i) => [i.Name, ...i.Aliases].map((j) => j.toLowerCase())));
	return supibot.filter((i) => !known.has(i.Name)).sort((a, b) => a.Name.localeCompare(b.Name));
};

/** Zeilenformat fuer cmdlist.js (#cmds) auf dem eigenen Haste-Server: "$ name ($a, $b) — Beschreibung" */
const formatSupibotOnly = (list) =>
	list
		.map((i) => {
			const aliases = i.Aliases.length > 0 ? ` (${i.Aliases.map((j) => `$${j}`).join(', ')})` : '';
			return `$ ${i.Name}${aliases} — ${i.Description ?? 'no description'}`;
		})
		.join('\n');

module.exports = { SUPIBOT_COMMANDS_DIR, loadSupibotCommands, supibotOnly, formatSupibotOnly };
