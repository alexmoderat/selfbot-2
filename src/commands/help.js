const { getCommand, commands, toListed } = require('../commandHandler.js');
const { formatUsage } = require('../util/command-listing.js');

// Command-Liste und Einzelhilfe wie sb-v2s commands (alexmoderat, 24.10.2026: "Wie die alte sb-v2-Seite"). Die Liste
// ist dieselbe Seite wie bei botcommands (/commands).

/** Einzelhilfe wie sb-v2: "name (aliases) · Beschreibung · Permission: mod · Cooldown: 3s · Usage: sb ..." */
const formatCommandHelp = (command, prefix) => {
	const listed = toListed(command);
	const parts = [`${listed.Name}${listed.Aliases.length > 0 ? ` (${listed.Aliases.join(', ')})` : ''}`];
	if (listed.Description) {
		parts.push(listed.Description);
	}
	parts.push(`Permission: ${listed.permission}`, `Cooldown: ${command.cooldown / 1000}s`);
	const usage = formatUsage(listed, prefix);
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
	formatCommandHelp,
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

		// Seite /commands kommt mit dem Web (Phase 5); bis dahin der Link auf die alte Seite bzw. nur die Anzahl
		const base = process.env.WEB_BASE_URL;
		const link = base ? `: ${base.replace(/\/$/, '')}/commands` : ' loaded.';
		return { text: `@${msg.displayName}, ${commands.size} commands${link}` };
	},
};
