const { client } = require('../util/twitch/connections.js');
const { helix } = require('../token/helix.js');
const { trimMessage } = require('../util/twitch/utils.js');
const { Logger, LogLevel } = require('../misc/logger.js');

const { JOIN } = require('./events/JOIN.js');
const { PART } = require('./events/PART.js');
const { WHISPER } = require('./events/WHISPER.js');
const { CLEARCHAT } = require('./events/CLEARCHAT.js');
const { NOTICE } = require('./events/NOTICE.js');
const { PRIVMSG } = require('./events/PRIVMSG.js');
const { USERNOTICE } = require('./events/USERNOTICE.js');
const { USERSTATE } = require('./events/USERSTATE.js');
const { main, isServed } = require('./JoinChannels.js');

// Wie DontAddThisBots clients/twitch.js: alle Event-Handler registrieren, dann die Channels joinen.
// Dazu "bot.Twitch": das Plattform-Objekt fuer den Rest des Bots, mit denselben Namen wie selfbots TwitchPlatform
// (send(message, channel), joinChannel, selfId, ...), damit portierte Services und Module gleich bleiben.

const Twitch = async function () {
	for (const execute of [JOIN, PART, WHISPER, CLEARCHAT, NOTICE, PRIVMSG, USERNOTICE, USERSTATE, main]) {
		await execute();
	}
};

/** Live-Channels (Twitch-IDs) - bot.Live */
const liveIds = () => bot.Live;

const platform = {
	ID: 1,
	name: 'twitch',
	get selfName() {
		return bot.Config.selfName.toLowerCase();
	},
	get selfId() {
		return bot.Config.selfId;
	},
	get Message_Limit() {
		return bot.Config.messageLimit;
	},
	get liveIds() {
		return liveIds();
	},
	debug: false,

	/**
	 * In einen Channel senden (per IRC, gedrosselt von dank-twitch-irc)
	 * @param {string} message
	 * @param {object} channel Channel aus services/channels.js
	 * @param {{ replyTo?: string|null }} [options]
	 */
	async send(message, channel, options = {}) {
		if (!isServed(channel.name)) {
			return;
		}
		const text = trimMessage(message, bot.Config.messageLimit);
		if (!text) {
			return;
		}
		if (options.replyTo) {
			await client.reply(channel.name, options.replyTo, text);
		} else {
			await client.say(channel.name, text);
		}
	},

	/** Per Broadcaster-ID senden, auch in Channels ohne Eintrag (z. B. Modlog-Channel): dann ueber Helix */
	async sendToBroadcaster(message, broadcasterId, options = {}) {
		const channel = bot.Channels.getByTwitchId(broadcasterId);
		if (channel && client.joinedChannels.has(channel.name)) {
			await platform.send(message, channel, options);
			return;
		}
		const response = await helix('chat/messages', {
			method: 'POST',
			json: {
				broadcaster_id: broadcasterId,
				sender_id: bot.Config.selfId,
				message: trimMessage(message, bot.Config.messageLimit),
				...(options.replyTo ? { reply_parent_message_id: options.replyTo } : {}),
			},
		});
		const result = response.body?.data?.[0];
		if (!response.ok || !result?.is_sent) {
			Logger.log(LogLevel.WARN, '[twitch] Senden per Helix fehlgeschlagen', {
				broadcasterId,
				statusCode: response.statusCode,
				drop: result?.drop_reason,
			});
		}
	},

	/** Whisper ueber Helix (Scope user:manage:whispers) */
	async pm(message, user) {
		if (!user?.twitchId) {
			Logger.log(LogLevel.WARN, '[twitch] Whisper ohne Twitch-ID nicht moeglich', { user: user?.name });
			return;
		}
		const response = await helix('whispers', {
			method: 'POST',
			searchParams: { from_user_id: bot.Config.selfId, to_user_id: user.twitchId },
			json: { message: trimMessage(message, 500) },
			responseType: 'text',
		});
		if (!response.ok) {
			Logger.log(LogLevel.WARN, '[twitch] Whisper fehlgeschlagen', { user: user.name, statusCode: response.statusCode, body: response.body });
		}
	},

	/** Channel joinen (IRC), PubSub und EventSub abonnieren */
	async joinChannel(channel) {
		if (isServed(channel.name)) {
			await client.join(channel.name).catch((e) => Logger.log(LogLevel.WARN, `[join] ${channel.name}: ${e.message}`));
		}
		bot.PubSub?.subscribeChannel(channel);
		void bot.EventSub?.syncChannel(channel);
	},

	async leaveChannel(channel) {
		bot.PubSub?.unsubscribeChannel(channel);
		void bot.EventSub?.unsubscribeChannel(channel);
		if (client.joinedChannels.has(channel.name)) {
			await client.part(channel.name).catch(() => {});
		}
	},

	isChannelLive(channel) {
		return channel.twitchId ? bot.Live.has(channel.twitchId) : null;
	},

	isUserChannelOwner(channel, user) {
		return Boolean(channel.twitchId && user.twitchId === channel.twitchId);
	},

	/** Live-Status aus PubSub (stream-up/-down); meldet online/offline an die Module */
	setStreamState(broadcasterId, online) {
		if (online === bot.Live.has(broadcasterId)) {
			return; // PubSub meldet teils mehrfach
		}
		if (online) {
			bot.Live.add(broadcasterId);
		} else {
			bot.Live.delete(broadcasterId);
		}
		const channel = bot.Channels.getByTwitchId(broadcasterId);
		if (channel) {
			bot.ChatModules.dispatch(online ? 'online' : 'offline', { channel });
		}
	},

	/** Live-Status aller aktiven Channels per Helix (beim Start und als Abgleich) */
	async loadLiveChannels() {
		const ids = bot.Channels.getJoinable()
			.map((i) => i.twitchId)
			.filter(Boolean);
		const live = new Set();
		for (let i = 0; i < ids.length; i += 100) {
			const params = new URLSearchParams([...ids.slice(i, i + 100).map((id) => ['user_id', id]), ['first', '100']]);
			const response = await helix('streams', { searchParams: params });
			for (const stream of response.body?.data ?? []) {
				live.add(stream.user_id);
			}
		}
		bot.Live.clear();
		live.forEach((id) => bot.Live.add(id));
		return live.size;
	},

	/** Whisper an einen User (Alias fuer pm, Reihenfolge wie die restlichen Helfer) */
	whisper: (user, message) => platform.pm(message, user),
};

module.exports = { Twitch, platform };
