const { defineCron } = require('../timers.js');
const { refresh } = require('../../../util/mod-leaderboard.js');

/** Baut das kanaluebergreifende Mod-Leaderboard alle 6 h neu auf (aus sb-v2, rein lesend) */
module.exports = defineCron({
	name: 'mod-leaderboard',
	expression: '0 15 */6 * * *',
	description: 'Rebuilds the cross-channel moderator leaderboard every 6 hours.',
	code: async function modLeaderboard() {
		const platform = bot.Twitch;
		const channels = bot.Channels.getJoinable().map((i) => i.Name);
		await refresh(channels, platform.selfName);
	},
});
