const { getWatchtime } = require('../services/channel-stats.js');
const { formatMinutes } = require('../misc/tracking-format.js');

/** Wie lange ein User den Channel geschaut hat (Cron watchtime), aus sb-v2 */
module.exports = {
	name: 'watchtime',
	aliases: ['wt'],
	cooldown: 3000,
	description: 'How long a user has watched the channel.',
	usage: 'watchtime [user]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const target = (targetRaw ?? msg.sender.name).replace('@', '').toLowerCase();
		const row = await getWatchtime(channel, target);
		if (!row) {
			return { text: `@${display}, no watchtime recorded for ${target} in #${channel.name} yet.` };
		}

		return { text: `${target} has spent ${formatMinutes(row.Minutes)} watching ${channel.name}` };
	},
};
