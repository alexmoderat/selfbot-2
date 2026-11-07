const { getCommand, commands, permissionOf } = require('../clients/modules/commands.js');

// Command-Liste und Einzelhilfe wie sb-v2s commands. Die Liste verlinkt die Seite /commands (kommt mit Phase 5,
// bis dahin nur die Anzahl).

/** "sb" -> "sb ", "?" -> "?" (Wortprefixe brauchen ein Leerzeichen, Zeichenprefixe nicht) */
const spacePrefix = (prefix) => (/^[a-z0-9]/i.test(prefix) ? `${prefix} ` : prefix);

/** Usage-Zeile mit Prefix; Usages, die schon mit "!" anfangen, bleiben unveraendert */
const formatUsage = (command, prefix) => {
	if (!command.usage) {
		return null;
	}
	if (command.usage.startsWith('!')) {
		return command.usage;
	}
	return `${command.flags.includes('no-prefix') ? '!' : spacePrefix(prefix)}${command.usage}`;
};

/** "name (aliases) · Beschreibung · Permission: mod · Cooldown: 3s · Usage: sb ..." */
const formatCommandHelp = (command, prefix) => {
	const parts = [`${command.name}${command.aliases.length > 0 ? ` (${command.aliases.join(', ')})` : ''}`];
	if (command.description) {
		parts.push(command.description);
	}
	parts.push(`Permission: ${permissionOf(command)}`, `Cooldown: ${command.cooldown / 1000}s`);
	const usage = formatUsage(command, prefix);
	if (usage) {
		parts.push(`Usage: ${usage}`);
	}
	return parts.join(' · ');
};

module.exports = {
	name: 'help',
	aliases: ['commands', 'cmds'],
	cooldown: 3000,
	description: 'Lists all loaded commands; with an argument, help for a single one.',
	usage: 'help [command]',
	flags: ['mod'],
	formatUsage,
	formatCommandHelp,
	spacePrefix,
	execute: async (client, msg) => {
		const [target] = msg.args;
		if (target) {
			const name = target.toLowerCase().replace(/^[!#]+/, '');
			const command = getCommand(name);
			if (!command) {
				return { text: `@${msg.displayName}, no command "${name}".` };
			}
			return { text: `@${msg.displayName}, ${formatCommandHelp(command, bot.Config.prefix)}` };
		}

		const base = process.env.WEB_BASE_URL;
		const link = base ? `: ${base.replace(/\/$/, '')}/commands` : ' loaded.';
		return { text: `@${msg.displayName}, ${commands.size} commands${link}` };
	},
};
