const { topListHint } = require('../misc/tracking-format.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getWatchStreak } = require('../services/channel-stats.js');
const { formatSharedDate, formatShortDate } = require('../misc/tracking-format.js');

/** Letzter bekannter Watch-Streak eines Zuschauers in diesem Channel, aus sb-v2 (ninou2 schreibt "!vs", 06.10.2026) */
module.exports = {
	name: 'viewerstreak',
	aliases: ['vs'],
	cooldown: 3000,
	description: 'Shows the last known Watch streak of a viewer in this channel (only recorded where the bot is present).',
	usage: 'viewerstreak [user]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return { text: `@${display}, this only works in a channel.` };
		}

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

		const row = await getWatchStreak(channel.twitchId, user.id);
		if (!row) {
			return { text: `@${display}, no watch streak recorded for ${login} in #${channel.name} yet.` };
		}

		const best =
			row.Best_Value && row.Best_Seen_At ? ` [his longest streak ever was at > ${row.Best_Value} < on ${formatShortDate(row.Best_Seen_At)}]` : '';
		return {
			text: `@${display}, ${login} current Watch streak on ${channel.name} stream is at : > ${row.Value} < (last shared on ${formatSharedDate(row.Seen_At)})${best}`,
		};
	},
};
