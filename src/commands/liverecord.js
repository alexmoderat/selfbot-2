const { getRecord } = require('../services/channel-stats.js');
const { formatDuration } = require('../misc/duration.js');

/** Rekord gleichzeitig live gewesener Channels unter den eigenen (Cron live-record), aus sb-v2 */
module.exports = {
	name: 'liverecord',
	cooldown: 3000,
	description: 'Shows the highest number of simultaneously live channels ever seen among the joined channels.',
	usage: 'liverecord',
	execute: async (client, msg) => {
		const record = await getRecord('live_channels');
		if (!record) {
			return { text: `@${msg.displayName}, no record tracked yet — check back in ~15min.` };
		}

		return {
			text: `@${msg.displayName}, record: ${record.Value} channels live at once (${formatDuration(Date.now() - Number(record.Achieved.valueOf()))} ago).`,
		};
	},
};
