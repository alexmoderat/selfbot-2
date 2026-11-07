const { uploadList } = require('../misc/haste.js');
const { getTop, refresh } = require('../services/mod-leaderboard.js');

/**
 * Wer in den meisten unserer Channels Mod ist (ninou2, 19.08.2026: "is there a leaderboard for most mod a twitch
 * chatter have, without counting famous bots"), aus sb-v2. Liest den Stand von crons/mod-leaderboard, baut bei leerem
 * Stand (frischer Start) einmal selbst auf.
 */
module.exports = {
	name: 'modleaderboard',
	aliases: ['modlb'],
	cooldown: 3000,
	description: 'Who moderates the most of our channels (excluding known bots).',
	usage: 'modleaderboard',
	flags: ['mod'],
	execute: async (client, msg) => {
		const display = msg.displayName;
		let { entries, builtAt } = await getTop(10);

		if (entries.length === 0) {
			// Immer die Twitch-Channels, auch wenn der Aufruf aus der Net-Konsole kommt
			const twitch = bot.Twitch;
			const channels = bot.Channels.getJoinable().map((i) => i.Name);
			if (channels.length === 0) {
				return { text: `@${display}, no channel data available yet.` };
			}

			await refresh(channels, twitch.selfName);
			({ entries, builtAt } = await getTop(10));
			if (entries.length === 0) {
				return { text: `@${display}, could not build the leaderboard right now.` };
			}
		}

		const lines = entries.map((i, index) => `${index + 1}. ${i.login} — ${i.count} channels`);
		const url = await uploadList('Mod leaderboard', lines);
		const age = builtAt ? Math.round((Date.now() - builtAt) / 60000) : null;
		return { text: `@${display}, mod leaderboard${age !== null ? ` (${age}m old)` : ''}: ${url}` };
	},
};
