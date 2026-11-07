const { Logger } = require('../misc/logger.js');
const { isServed } = require('./JoinChannels.js');
const { pubsub } = require('../services/pubsub.js');
const { subscribeAll: subscribeNotifications } = require('../services/notifications.js');
const firehose = require('../services/catquery-firehose.js');
const joinPoller = require('../services/join-poller.js');
const { chatLogger } = require('../services/chat-logger.js');
const { recordWatchStreak } = require('../services/channel-stats.js');

// Alles, was nach dem IRC-Connect hochfaehrt (bisher TwitchPlatform.connect im alten selfbot, transport "irc"):
// PubSub-Abos, Notify-Streamer, CatQuery-Firehose, Join-Poller und Chat-Logger.
// Parallelbetrieb: PubSub nur fuer die bedienten Channels, kein Firehose (CatQuery laesst nur wenige Verbindungen
// je IP zu, der alte selfbot haelt schon eine).

const startPubSub = () => {
	pubsub.init(bot.Twitch);
	bot.PubSub = pubsub;
	const channels = bot.Channels.getJoinable().filter((i) => isServed(i.name));
	for (const channel of channels) {
		pubsub.subscribeChannel(channel);
	}
	pubsub.subscribeSelf();
	Logger.info(`[pubsub] ${channels.length} Channel(s) abonniert`);

	// notify live / titlenotify: beobachtete Streamer (auch nicht gejointe) - crons/notify-resync holt Neue nach
	void subscribeNotifications()
		.then((counts) => Logger.info(`[notifications] ${counts.live} Live- und ${counts.title} Titel-Streamer abonniert`))
		.catch((e) => Logger.warn('[twitch] Notify-Abos fehlgeschlagen', e));
};

const startFirehose = () => {
	if (bot.Config.parallelMode || process.env.CATQUERY_FIREHOSE === '0') {
		Logger.info('[catquery] Firehose aus (Parallelbetrieb bzw. CATQUERY_FIREHOSE=0)');
		return;
	}

	// Erstnachricht-Flag, Mod-Jubilaeen/Meilensteine und Watch-Streaks aus allen Channels (wie im alten Bot)
	firehose.start(
		(roomId) => {
			const channel = bot.Channels.getByTwitchId(roomId);
			return Boolean(channel && channel.mode !== 'Inactive');
		},
		(notice) => {
			const channel = bot.Channels.getByTwitchId(notice.roomId);
			if (!channel) {
				return;
			}
			bot.ChatModules.dispatch('usernotice', {
				channel,
				msgId: notice.msgId,
				userId: String(notice.tags['user-id'] ?? ''),
				userName: String(notice.tags.login ?? '').toLowerCase(),
				tags: notice.tags,
				text: notice.text,
			});
		},
		(notice) => {
			const value = Number.parseInt(String(notice.tags['msg-param-value'] ?? ''), 10);
			const userId = String(notice.tags['user-id'] ?? '');
			const login = String(notice.tags.login ?? '');
			if (!notice.roomId || !userId || !login || !notice.channel || !Number.isFinite(value)) {
				return;
			}
			void recordWatchStreak({ channelId: notice.roomId, channel: notice.channel, userId, login, value }).catch((e) =>
				Logger.warn('[watch-streak] Speichern fehlgeschlagen', e),
			);
		},
	);
};

/** Nach dem ersten "ready" von dank-twitch-irc */
const startServices = () => {
	startPubSub();
	startFirehose();
	joinPoller.start(bot.Twitch);
	chatLogger.start();
};

module.exports = { startServices, chatLogger, firehose };
