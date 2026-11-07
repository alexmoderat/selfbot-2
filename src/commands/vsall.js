const { topListHint } = require('../misc/tracking-format.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getBestWatchStreak } = require('../services/channel-stats.js');
const { formatShortDate } = require('../misc/tracking-format.js');

/** Laengster gesehener Watch-Streak eines Zuschauers in irgendeinem Channel, aus sb-v2 */
module.exports = {
	name: 'vsall',
	aliases: ['vsbest'],
	cooldown: 3000,
	description: 'Longest watch streak the bot has seen for a viewer in any channel.',
	usage: 'vsall [user]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		// "!vsall 3", "!vs top3": gemeint ist die Top-Liste (ninou2, 17. und 24.10.2026) - die gibt es als !vstop
		const top = topListHint(userRaw);
		if (top) {
			return { text: `@${display}, ${top}` };
		}
		const login = (userRaw ?? msg.sender.name).replace(/^@/, '').toLowerCase();
		const user = await fetchTwitchUser(login).catch(() => null);
		if (!user) {
			return { text: `@${display}, no Twitch account named "${login}" exists.` };
		}

		const best = await getBestWatchStreak(user.id);
		if (!best?.Best_Value || !best.Best_Seen_At) {
			return { text: `@${display}, no watch streak recorded for ${login} yet.` };
		}

		return {
			text: `@${display}, ${login}'s longest watch streak seen in any channel: > ${best.Best_Value} < in #${best.Channel_Name} (on ${formatShortDate(best.Best_Seen_At)})`,
		};
	},
};
