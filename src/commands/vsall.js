const { topListHint } = require('../util/tracking-format.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getBestWatchStreak } = require('../util/channel-stats.js');
const { formatShortDate } = require('../util/tracking-format.js');

/** Laengster gesehener Watch-Streak eines Zuschauers in irgendeinem Channel, aus sb-v2 */
const command = {
	name: 'vsall',
	aliases: ['vsbest'],
	cooldown: { user: 3 },
	access: { channel: 0 },
	description: 'Longest watch streak the bot has seen for a viewer in any channel.',
	usage: 'vsall [user]',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		// "!vsall 3", "!vs top3": gemeint ist die Top-Liste (ninou2, 17. und 24.10.2026) - die gibt es als !vstop
		const top = topListHint(userRaw);
		if (top) {
			return `@${display}, ${top}`;
		}
		const login = (userRaw ?? msg.sender.name).replace(/^@/, '').toLowerCase();
		const user = await fetchTwitchUser(login).catch(() => null);
		if (!user) {
			return `@${display}, no Twitch account named "${login}" exists.`;
		}

		const best = await getBestWatchStreak(user.id);
		if (!best?.Best_Value || !best.Best_Seen_At) {
			return `@${display}, no watch streak recorded for ${login} yet.`;
		}

		return `@${display}, ${login}'s longest watch streak seen in any channel: > ${best.Best_Value} < in #${best.Channel_Name} (on ${formatShortDate(best.Best_Seen_At)})`;
	},
};

module.exports = { command };
