const { Logger } = require('../../../misc/logger.js');
const { defineCron } = require('../timers.js');
const { updateRecordIfHigher } = require('../../../util/channel-stats.js');
const { fetchLiveStreams } = require('../../../util/live-variables.js');

/**
 * Rekord der Gesamt-Viewer aller gleichzeitig live Channels, fuer !wilbv (ninou2, 22.11.2026: "!wilbv", "the viewers best
 * recorded"); Channels mit ihren Viewern, meiste zuerst
 */
const recordLiveViewers = async () => {
	const ids = bot.Channels.getJoinable()
		.map((i) => i.twitchId)
		.filter((i) => Boolean(i));
	const streams = await fetchLiveStreams(ids);
	const total = streams.reduce((sum, i) => sum + (i.viewers ?? 0), 0);
	const channels = streams.map((i) => ({ login: i.login, viewers: i.viewers ?? 0 })).sort((a, b) => b.viewers - a.viewers || a.login.localeCompare(b.login));
	if (total > 0 && (await updateRecordIfHigher('live_viewers', total, channels))) {
		Logger.info(`[live-record] Neuer Viewer-Rekord: ${total} Viewer in ${channels.length} Channels`);
	}
};

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

		await recordLiveViewers().catch((e) => Logger.warn(`[live-record] Viewer-Rekord: ${e?.message ?? e}`));
	},
});
Object.assign(module.exports, { recordLiveViewers });
