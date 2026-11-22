const { answerNthBotBan } = require('../util/moderation.js');

/**
 * Datum des N-ten Bot-Banns, im Channel oder ueber alle Channels (ninou2, 28.10.2026: "switch it to !whenBotBans !wbb",
 * damit !botbans seine gewohnten Zahlen behaelt). Nummeriert nach dem Ban-Log, nicht nach dem !botbans-Zaehler.
 */
const command = {
	name: 'whenbotbans',
	aliases: ['wbb'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'When did the bot make its N-th ban in this channel (or globally)?',
	usage: 'whenbotbans <number> | whenbotbans global <number>',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const args = [...msg.args];
		const channel = msg.channelData;
		const display = msg.displayName;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		const reply = await answerNthBotBan(args, channel.name, display);
		return reply ?? `@${display}, Usage: ${msg.prefix}${msg.invocation} <number> | ${msg.invocation} global <number>`;
	},
};

module.exports = { command };
