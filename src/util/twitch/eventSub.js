const WebSocket = require('ws');

const { helix } = require('../../token/helix.js');
const { Logger, LogLevel } = require('../../misc/logger.js');
const { isServed } = require('../../clients/JoinChannels.js');
const eventSubEvents = require('./eventSubEvents.js');

/**
 * EventSub ueber WebSocket wie DontAddThisBot (src/util/twitch/eventSub.js), bisher nur channel.follow.
 * channel.follow v2 braucht moderator_user_id + moderator:read:followers -> nur Channels mit Mode Moderator.
 * Abos haengen an der Session: nach einem Verbindungsabbruch sind sie weg und werden neu angelegt; bei
 * session_reconnect wandern sie mit auf die neue URL. Twitch: hoechstens 300 Abos je WebSocket.
 */
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const MAX_SUBSCRIPTIONS = 300;
const TYPES = [{ type: 'channel.follow', version: '2' }];

let socket = null;
let sessionId = null;
let watchdog = null;
let reconnectDelay = 1000;
let stopped = false;
const subscriptions = new Map(); // twitchId -> Map(type -> subscriptionId)
const seenMessages = new Set();

/** Gehoert der Channel ins EventSub? (Mod-Rechte noetig, eigener Channel immer) */
const wantsChannel = (channel) => Boolean(channel?.twitchId) && isServed(channel.name) && (channel.mode === 'Moderator' || (channel.twitchId === bot.Twitch.selfId && channel.mode !== 'Inactive'));

const subscriptionCount = () => [...subscriptions.values()].reduce((sum, types) => sum + types.size, 0);

const createSubscription = async (channel, { type, version }) => {
	const response = await helix('eventsub/subscriptions', {
		method: 'POST',
		json: {
			type,
			version,
			condition: { broadcaster_user_id: channel.twitchId, moderator_user_id: bot.Twitch.selfId },
			transport: { method: 'websocket', session_id: sessionId },
		},
	});

	if (!response.ok) {
		Logger.log(LogLevel.WARN, `[eventsub] ${type} fuer #${channel.name} fehlgeschlagen (${response.statusCode}): ${response.body?.message ?? ''}`);
		return;
	}

	const id = response.body?.data?.[0]?.id;
	if (!subscriptions.has(channel.twitchId)) {
		subscriptions.set(channel.twitchId, new Map());
	}
	subscriptions.get(channel.twitchId).set(type, id);
};

const subscribeChannel = async (channel) => {
	if (!sessionId || !wantsChannel(channel)) {
		return;
	}

	const existing = subscriptions.get(channel.twitchId);
	for (const spec of TYPES) {
		if (existing?.has(spec.type)) {
			continue;
		} else if (subscriptionCount() >= MAX_SUBSCRIPTIONS) {
			Logger.log(LogLevel.WARN, `[eventsub] Limit von ${MAX_SUBSCRIPTIONS} Abos erreicht, #${channel.name} ohne ${spec.type}`);
			return;
		}
		await createSubscription(channel, spec);
	}
};

const unsubscribeChannel = async (channel) => {
	const existing = channel?.twitchId ? subscriptions.get(channel.twitchId) : null;
	if (!existing) {
		return;
	}

	subscriptions.delete(channel.twitchId);
	for (const id of existing.values()) {
		await helix('eventsub/subscriptions', { method: 'DELETE', searchParams: { id }, responseType: 'text' }).catch(() => {});
	}
};

/** Abo an den aktuellen Mode anpassen (Join, Part, Mod-Wechsel) */
const syncChannel = async (channel) => {
	await (wantsChannel(channel) ? subscribeChannel(channel) : unsubscribeChannel(channel));
};

const subscribeAll = async () => {
	const channels = bot.Channels.getJoinable().filter(wantsChannel);
	for (const channel of channels) {
		await subscribeChannel(channel);
	}
	Logger.log(LogLevel.INFO, `[eventsub] ${subscriptionCount()} Abo(s) in ${subscriptions.size} Channel(s)`);
};

const resetWatchdog = (timeoutSeconds) => {
	clearTimeout(watchdog);
	// Keepalive verpasst -> Verbindung gilt als tot (Twitch-Doku: keepalive_timeout_seconds)
	watchdog = setTimeout(
		() => {
			Logger.log(LogLevel.WARN, '[eventsub] Kein Keepalive, neue Verbindung');
			socket?.terminate();
		},
		(timeoutSeconds + 10) * 1000,
	);
};

const handleNotification = (payload, messageId) => {
	if (seenMessages.has(messageId)) {
		return;
	}
	seenMessages.add(messageId);
	if (seenMessages.size > 1000) {
		seenMessages.delete(seenMessages.values().next().value);
	}

	const handler = eventSubEvents[payload.subscription?.type];
	if (handler) {
		Promise.resolve()
			.then(() => handler(payload.event, payload.subscription))
			.catch((e) => Logger.log(LogLevel.WARN, `[eventsub] ${payload.subscription.type}`, e));
	}
};

/** isReconnect: Twitch hat per session_reconnect umgezogen, die Abos bleiben bestehen */
const connect = (url = EVENTSUB_URL, isReconnect = false) => {
	const ws = new WebSocket(url);
	let keepaliveSeconds = 30;

	ws.on('message', (raw) => {
		let parsed;
		try {
			parsed = JSON.parse(raw.toString());
		} catch {
			return;
		}

		const { metadata, payload } = parsed;
		resetWatchdog(keepaliveSeconds);
		switch (metadata?.message_type) {
			case 'session_welcome': {
				const previous = socket;
				socket = ws;
				sessionId = payload.session.id;
				keepaliveSeconds = payload.session.keepalive_timeout_seconds ?? keepaliveSeconds;
				reconnectDelay = 1000;
				resetWatchdog(keepaliveSeconds);
				if (isReconnect) {
					Logger.log(LogLevel.INFO, '[eventsub] Auf neue Verbindung umgezogen');
					previous?.removeAllListeners('close');
					previous?.close();
				} else {
					Logger.log(LogLevel.INFO, '[eventsub] Verbunden');
					subscriptions.clear();
					void subscribeAll().catch((e) => Logger.log(LogLevel.WARN, '[eventsub] Abonnieren fehlgeschlagen', e));
				}
				break;
			}
			case 'session_reconnect':
				connect(payload.session.reconnect_url, true);
				break;
			case 'notification':
				handleNotification(payload, metadata.message_id);
				break;
			case 'revocation': {
				const { type, status, condition } = payload.subscription;
				subscriptions.get(condition.broadcaster_user_id)?.delete(type);
				Logger.log(LogLevel.WARN, `[eventsub] ${type} fuer ${condition.broadcaster_user_id} widerrufen (${status})`);
				break;
			}
		}
	});

	ws.on('close', (code) => {
		if (ws !== socket && socket !== null) {
			return;
		}
		clearTimeout(watchdog);
		socket = null;
		sessionId = null;
		subscriptions.clear();
		if (stopped) {
			return;
		}
		Logger.log(LogLevel.WARN, `[eventsub] Verbindung zu (${code}), neuer Versuch in ${reconnectDelay / 1000}s`);
		setTimeout(() => connect(), reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
	});

	ws.on('error', (e) => Logger.log(LogLevel.WARN, `[eventsub] ${e.message}`));
	if (!socket) {
		socket = ws;
	}
};

const start = () => {
	stopped = false;
	connect();
};

const stop = () => {
	stopped = true;
	clearTimeout(watchdog);
	socket?.close();
};

const status = () => ({ connected: Boolean(sessionId), subscriptions: subscriptionCount() });

module.exports = { start, stop, status, syncChannel, subscribeChannel, unsubscribeChannel, wantsChannel };
