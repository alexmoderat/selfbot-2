const { describeFailure, searchGameId, updateBroadcastSettings } = require('../util/broadcast-settings.js');
const { findGame } = require('../clients/modules/chat/stream-infos-restore.js');

// Eingefuegte !csi2-Zeile: "!setgame X !settitle Y" setzt beides (ninou2, 13.11.2026)
const COMBINED = /^(.+?)\s+!settitle\s+(.+)$/i;

/** Kategorie des aktuellen Channels setzen, aus sb-v2 (ninou2, 06.10.2026: !gamechange / !gc) */
const command = {
	name: 'setgame',
	aliases: ['game', 'setcategory', 'gamechange', 'gc'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Sets the category of the current channel.',
	usage: 'setgame <game>',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const gameName = words.join(' ').trim();
		if (!channel || !gameName) {
			return `@${display}, Usage: ${msg.invocation} <game>`;
		}

		const combined = COMBINED.exec(gameName);
		if (combined) {
			const [, wantedGame, title] = combined;
			const found = await findGame(wantedGame.trim());
			if (!found) {
				return `@${display}, game "${wantedGame.trim()}" not found.`;
			}

			const both = await updateBroadcastSettings(channel, { title: title.trim(), gameId: found.id, gameName: found.name });
			return both.ok ? `@${display}, stream infos restored: "${found.name}" - "${title.trim()}"` : describeFailure(both, display);
		}

		const gameId = await searchGameId(gameName);
		if (!gameId) {
			return `@${display}, game "${gameName}" not found.`;
		}

		const result = await updateBroadcastSettings(channel, { gameId, gameName });
		if (!result.ok) {
			return describeFailure(result, display);
		}

		return `@${display}, game updated to "${gameName}".`;
	},
};

module.exports = { command };
