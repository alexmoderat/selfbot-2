const { getCommand } = require('../commandHandler.js');
const { formatUsage } = require('../util/command-listing.js');

/**
 * Erklaert einen Command direkt im Chat: Name, Aliase, Beschreibung und Aufruf (aus sb-v2).
 * ninou2, 06.10.2026: "you create a command that post the explanation in the chat, exemple : !how tc"
 */
const MAX_LENGTH = 400;

const command = {
	name: 'how',
	cooldown: { user: 3 },
	access: { channel: 0 },
	description: 'Explains a command in chat: aliases, what it does and how to call it.',
	usage: 'how <command>',
	// Mit "!" aufrufbar, wie !bio und !title
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const [nameRaw] = msg.args;
		const name = (nameRaw ?? '').toLowerCase().replace(/^[!#]+/, '');
		const command = getCommand(name);
		if (!command) {
			return `@${msg.displayName}, no command "${name}".`;
		}

		const info = command.toListed();
		const aliases = info.Aliases.length > 0 ? ` (aliases: ${info.Aliases.map((i) => `!${i}`).join(', ')})` : '';
		const usage = formatUsage(info, bot.Config.prefix);
		const usageText = usage ? ` Usage: ${usage}.` : '';
		const description = (info.Description ?? '').replace(/\s+/g, ' ').trim();

		const text = `!${info.Name}${aliases}: ${description}${usageText}`.trim();
		const short = text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 3)}...` : text;
		return `@${msg.displayName}, ${short}`;
	},
};

module.exports = { command };
