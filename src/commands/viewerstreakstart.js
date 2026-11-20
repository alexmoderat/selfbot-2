const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getWatchStreak } = require('../util/channel-stats.js');
const { streamData } = require('../util/stream-tracking.js');
const { formatStreakStart } = require('../util/tracking-format.js');

/**
 * Wann der Watch-Streak eines Zuschauers begann, geschaetzt aus dem letzten geteilten Wert und den Streamtagen, dazu die erste
 * gesehene Teilung (ninou2, 03.11.2026: "!viewerstreakstart !vss", "better tell when the 1st started").
 */
module.exports = {
	name: 'viewerstreakstart',
	aliases: ['vss'],
	cooldown: 3000,
	description: "Shows about when a viewer's Watch streak started in this channel, estimated from their last shared streak and the stream days, and their first shared streak if known.",
	usage: 'viewerstreakstart [user]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel?.twitchId) {
			return { text: `@${display}, this only works in a channel.` };
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

		const days = await streamData.getDays(channel.twitchId);
		return { text: `@${display}, ${formatStreakStart(login, channel.name, row, days)}.` };
	},
};
