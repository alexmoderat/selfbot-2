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
const { main, isServed } = require('./JoinChannels.js');

// Wie DontAddThisBots clients/twitch.js: alle Event-Handler registrieren, dann die Channels joinen.
// Dazu die Sende-Funktionen, die der Rest des Bots ueber bot.Twitch nutzt.

exports.Twitch = async function () {
	for (const execute of [JOIN, PART, WHISPER, CLEARCHAT, NOTICE, PRIVMSG, USERNOTICE, main]) {
		await execute();
	}
};

/**
 * In einen Channel senden (per IRC, gedrosselt von dank-twitch-irc)
 * @param {object} channel Channel-Objekt aus services/channels.js
 * @param {{ replyTo?: string|null }} [options]
 */
exports.send = async (channel, message, options = {}) => {
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
};

/** In einen Channel per Login senden, auch wenn er nicht in der DB steht (z. B. Modlog-Channel) */
exports.sendToLogin = async (login, message) => {
	await client.say(login.toLowerCase(), trimMessage(message, bot.Config.messageLimit));
};

/** Whisper ueber Helix (Scope user:manage:whispers) */
exports.whisper = async (user, message) => {
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
};

exports.join = (channel) => {
	if (isServed(channel.name)) {
		return client.join(channel.name);
	}
};

exports.part = (channel) => client.part(channel.name);

/** Live-Status aller aktiven Channels per Helix (bis PubSub stream-up/-down das uebernimmt) */
exports.loadLiveChannels = async () => {
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
};
