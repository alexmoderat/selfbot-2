const { describeFailure, searchGameId, updateBroadcastSettings } = require('../misc/broadcast-settings.js');

/** Kategorie des aktuellen Channels setzen, aus sb-v2 (ninou2, 06.10.2026: !gamechange / !gc) */
module.exports = {
	name: 'setgame',
	aliases: ['game', 'setcategory', 'gamechange', 'gc'],
	cooldown: 3000,
	description: 'Sets the category of the current channel.',
	usage: 'setgame <game>',
	flags: ['mod', 'no-prefix'],
	execute: async (client, msg) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const gameName = words.join(' ').trim();
		if (!channel || !gameName) {
			return { text: `@${display}, Usage: ${msg.invocation} <game>` };
		}

		const gameId = await searchGameId(gameName);
		if (!gameId) {
			return { text: `@${display}, game "${gameName}" not found.` };
		}

		const result = await updateBroadcastSettings(channel, { gameId, gameName });
		if (!result.ok) {
			return { text: describeFailure(result, display) };
		}

		return { text: `@${display}, game updated to "${gameName}".` };
	},
};
