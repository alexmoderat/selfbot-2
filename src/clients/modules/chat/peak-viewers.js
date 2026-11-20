const { defineChatModule } = require('../chat-modules.js');
const { recordPeakIfHigher } = require('../../../util/channel-stats.js');

/** Hoechste je gesehene Zuschauerzahl pro Channel und Jahr (PubSub video-playback viewcount, fuer !peak), aus sb-v2 */
const known = new Map();

module.exports = defineChatModule({
	name: 'peak-viewers',
	description: 'Records the highest viewer count ever seen per channel (for peak).',
	scope: 'global',
	handlers: {
		videoPlayback: async (context) => {
			const payload = context.payload;
			const viewers = Number(payload?.viewers);
			if (!context.channel || payload?.type !== 'viewcount' || !Number.isFinite(viewers) || viewers <= 0) {
				return;
			}

			const year = new Date().getUTCFullYear();
			const key = `${context.broadcasterId}:${year}`;
			if ((known.get(key) ?? 0) >= viewers) {
				return;
			}

			known.set(key, viewers);
			await recordPeakIfHigher(context.broadcasterId, context.channel.name, year, viewers).catch((e) =>
				console.warn(`[peak-viewers] #${context.channel?.name}`, e),
			);
		},
	},
});
