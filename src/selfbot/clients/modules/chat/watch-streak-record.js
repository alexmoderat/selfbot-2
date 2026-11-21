const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');
const { recordWatchStreak } = require('../../../util/channel-stats.js');

/**
 * Letzter Watch-Streak-Stand je Zuschauer und Channel (fuer !viewerstreak), aus sb-v2. viewermilestone kommt nicht ueber
 * EventSub, nur ueber den CatQuery-Firehose - der zeichnet zusaetzlich alle anderen Channels auf (twitch.ts).
 */
module.exports = defineChatModule({
	name: 'watch-streak-record',
	description: 'Stores the latest watch streak per viewer and channel (for viewerstreak).',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags } = context;
			if (msgId !== 'viewermilestone' || tags['msg-param-category'] !== 'watch-streak') {
				return;
			}

			const value = Number.parseInt(String(tags['msg-param-value'] ?? ''), 10);
			const userId = String(tags['user-id'] ?? '');
			const login = String(tags.login ?? '');
			if (!userId || !login || !channel.twitchId || !Number.isFinite(value)) {
				return;
			}

			await recordWatchStreak({ channelId: channel.twitchId, channel: channel.name, userId, login, value }).catch((e) => Logger.warn('[watch-streak-record] Speichern fehlgeschlagen', e));
		},
	},
});
