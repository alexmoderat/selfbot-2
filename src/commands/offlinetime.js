const { getWatchtime } = require('../services/channel-stats.js');
const { formatMinutes } = require('../misc/tracking-format.js');

/** Zeit im Chat, waehrend der Channel offline war (ninou2, 17.09.2026: eigene Statistik), aus sb-v2 */
module.exports = {
	name: 'offlinetime',
	aliases: ['ot'],
	cooldown: 3000,
	description: 'How long a user has spent in chat while the channel was offline.',
	usage: 'offlinetime [user]',
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
			return { text: `@${display}, no offline chat time recorded for ${target} in #${channel.name} yet.` };
		}

		return { text: `${target} has spent ${formatMinutes(row.Offline_Minutes)} in offline chat for ${channel.name}` };
	},
};
