const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getAllTimePeak } = require('../services/channel-stats.js');
const { formatShortDate } = require('../misc/tracking-format.js');

/** Hoechste je gesehene Zuschauerzahl eines Channels (Modul peak-viewers), aus sb-v2 */
module.exports = {
	name: 'peak',
	aliases: ['peakviewers'],
	cooldown: 3000,
	description: 'Highest viewer count a channel has ever had, and when it happened. Defaults to the current channel.',
	usage: 'peak [channel]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const name = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = name === msg.channelData?.name;
		const user = name ? await fetchTwitchUser(name).catch(() => null) : null;
		if (!user) {
			return { text: `@${display}, no Twitch account named "${name}" exists.` };
		}

		const row = await getAllTimePeak(user.id);
		if (!row) {
			return {
				text: `@${display}, no viewer count recorded yet for ${own ? 'this channel' : `#${name}`} — either tracking just started, or that's not a channel I watch.`,
			};
		}

		return { text: `@${display}, ${name}'s highest viewer count: ${Number(row.Viewers).toLocaleString('en-US')} (${formatShortDate(row.Seen_At)})` };
	},
};
