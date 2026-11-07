const { answerNthBotBan } = require('../services/moderation.js');

/**
 * Datum des N-ten Bot-Banns, im Channel oder ueber alle Channels (ninou2, 28.10.2026: "switch it to !whenBotBans !wbb",
 * damit !botbans seine gewohnten Zahlen behaelt). Nummeriert nach dem Ban-Log, nicht nach dem !botbans-Zaehler.
 */
module.exports = {
	name: 'whenbotbans',
	aliases: ['wbb'],
	cooldown: 3000,
	description: 'When did the bot make its N-th ban in this channel (or globally)?',
	usage: 'whenbotbans <number> | whenbotbans global <number>',
	flags: ['mod', 'no-prefix'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const channel = msg.channelData;
		const display = msg.displayName;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const reply = await answerNthBotBan(args, channel.name, display);
		return { text: reply ?? `@${display}, Usage: ${msg.prefix}${msg.invocation} <number> | ${msg.invocation} global <number>` };
	},
};
