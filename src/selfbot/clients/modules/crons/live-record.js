const { Logger } = require('../../../misc/logger.js');
const { defineCron } = require('../timers.js');
const { updateRecordIfHigher } = require('../../../util/channel-stats.js');

/** Rekord an gleichzeitig live Channels unter den eigenen (alle 5 Minuten), aus sb-v2 */
module.exports = defineCron({
	name: 'live-record',
	expression: '15 */5 * * * *',
	description: 'Tracks the record of simultaneously live channels among the joined ones.',
	code: async function liveRecord() {
		// Logins mitspeichern, fuer !whoislivebest (ninou2, 18.11.2026: "a command that save the best !wil", "who were live")
		const live = [];
		for (const channel of bot.Channels.getJoinable()) {
			if (await bot.Channels.isLive(channel)) {
				live.push(channel.name);
			}
		}

		if (live.length > 0 && (await updateRecordIfHigher('live_channels', live.length, live))) {
			Logger.info(`[live-record] Neuer Rekord: ${live.length} live Channels (${live.join(', ')})`);
		}
	},
});
