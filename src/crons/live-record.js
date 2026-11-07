const { defineCron } = require('../clients/modules/timers.js');
const { updateRecordIfHigher } = require('../services/channel-stats.js');

/** Rekord an gleichzeitig live Channels unter den eigenen (alle 5 Minuten), aus sb-v2 */
module.exports = defineCron({
	name: 'live-record',
	expression: '15 */5 * * * *',
	description: 'Tracks the record of simultaneously live channels among the joined ones.',
	code: async function liveRecord() {
		const platform = bot.Twitch;
		let live = 0;
		for (const channel of bot.Channels.getJoinable()) {
			if (await bot.Channels.isLive(channel)) {
				live++;
			}
		}

		if (live > 0 && (await updateRecordIfHigher('live_channels', live))) {
			console.log(`[live-record] Neuer Rekord: ${live} live Channels`);
		}
	},
});
