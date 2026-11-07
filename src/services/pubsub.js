const { HermesPubSubClient } = require('../util/twitch/hermes-client.js');
const { LegacyPubSubClient } = require('../util/twitch/pubSub.js');
const { getUserToken, invalidateUserToken } = require('../util/twitch/twitch-utils.js');
const { getConfig } = require('../config.js');

// PubSub wie sb-v2s v2/singletons/pubsub.ts: ein Standard-Topic-Satz pro Channel, rohe Nachrichten werden als benannte
// Chat-Modul-Events verteilt ("raw" fuer alles, dazu z. B. "modAction").
// Transport per config.json "pubsub": "legacy" (Standard, wie DontAddThisBot: altes PubSub, Web-Token fuer
// Mod-Themen) oder "hermes" (Nachfolger aus der Twitch-Weboberflaeche, normaler User-Token) als Ausweg.

const TRANSPORT = getConfig().pubsub === 'hermes' ? 'hermes' : 'legacy';
const Client = TRANSPORT === 'hermes' ? HermesPubSubClient : LegacyPubSubClient;
// Hermes erlaubt 150 Abos je Verbindung, das alte PubSub 50
const MAX_TOPICS_PER_CONNECTION = TRANSPORT === 'hermes' ? 140 : LegacyPubSubClient.MAX_TOPICS;

/** Token fuer LISTEN: altes PubSub braucht fuer Mod-Themen den Web-Token (TWITCH_WEB_TOKEN), Hermes den User-Token */
const getToken = async () => (TRANSPORT === 'legacy' && process.env.TWITCH_WEB_TOKEN ? process.env.TWITCH_WEB_TOKEN : await getUserToken());
const SUBSCRIBE_DELAY = 15;
const TOKEN_REFRESH_INTERVAL = 15 * 60_000;
const LOG_RAW = process.env.PUBSUB_LOG_RAW === '1';

const PUBSUB_EVENTS = {
	chat_moderator_actions: 'modAction',
	'automod-queue': 'automodQueue',
	'low-trust-users': 'lowTrust',
	'video-playback-by-id': 'videoPlayback',
	'hype-train-events-v1': 'hypeTrain',
	'predictions-channel-v1': 'predictions',
	'community-points-channel-v1': 'channelPoints',
	raid: 'raid',
	'shield-mode': 'shieldMode',
	'channel-unban-requests': 'unbanRequest',
	'broadcast-settings-update': 'broadcastSettings',
	'chatrooms-user-v1': 'chatroomsUser',
};

/** Topic-Satz eines Channels; uid = eigene User-ID fuer moderator-gebundene Topics */
const channelTopics = (uid, broadcasterId) => [
	`chat_moderator_actions.${uid}.${broadcasterId}`,
	`automod-queue.${uid}.${broadcasterId}`,
	`low-trust-users.${uid}.${broadcasterId}`,
	`shield-mode.${uid}.${broadcasterId}`,
	`channel-unban-requests.${uid}.${broadcasterId}`,
	`video-playback-by-id.${broadcasterId}`,
	`hype-train-events-v1.${broadcasterId}`,
	`predictions-channel-v1.${broadcasterId}`,
	`community-points-channel-v1.${broadcasterId}`,
	`raid.${broadcasterId}`,
	`broadcast-settings-update.${broadcasterId}`,
];

/** "<prefix>.<uid>.<bid>" bzw. "<prefix>.<bid>" -> Prefix und Broadcaster-ID */
const parseTopic = (topic) => {
	const parts = topic.split('.');
	return {
		prefix: parts[0],
		broadcasterId: parts.length >= 3 ? parts[2] : parts[1],
	};
};

class PubSub {
	#platform = null;
	#selfId = '';
	#slots = [];
	#topicSlot = new Map();
	#queue = [];
	#timer = null;
	#reauthenticating = false;

	init(platform) {
		this.#platform = platform;
		this.#selfId = platform.selfId;

		// Den Verbindungen regelmaessig den aktuellen Token geben: bei einem Reconnect melden sie sich mit dem zuletzt
		// uebergebenen an - der vom Start ist nach ~4 h abgelaufen (Ausfall 26.10.2026, siehe hermes-client _open).
		// Bestehende Abos werden dabei uebersprungen, es geht nichts ueber die Leitung.
		setInterval(() => {
			void getToken()
				.then((token) => {
					for (const slot of this.#slots) {
						slot.client.listen([...slot.topics], token);
					}
				})
				.catch((e) => console.warn('[pubsub] Token-Auffrischung fehlgeschlagen', e));
		}, TOKEN_REFRESH_INTERVAL).unref();
	}

	#slot() {
		const free = this.#slots.find((i) => i.topics.size < MAX_TOPICS_PER_CONNECTION);
		if (free) {
			return free;
		}

		const client = new Client();
		const slot = { client, topics: new Set() };
		this.#slots.push(slot);
		const index = this.#slots.length;

		client.onMessage((topic, message) => this.#dispatch(topic, message));
		client.onListenError((topic, error, userInitiated) => {
			// userInitiated=false: Anmeldung abgelehnt, meist abgelaufener Token -> frisch holen und neu anmelden
			if (!userInitiated) {
				void this.#reauthenticate();
				return;
			}

			console.warn(`[pubsub] Listen-Fehler (${topic}): ${error.message}`);
		});
		client.onConnect(() => console.log(`[pubsub] Verbindung ${index} bereit (${TRANSPORT})`));
		client.connect();
		return slot;
	}

	async #reauthenticate() {
		if (this.#reauthenticating) {
			return;
		}

		this.#reauthenticating = true;
		try {
			// Der Web-Token laesst sich nicht erneuern - abgelehnt heisst: neuen TWITCH_WEB_TOKEN in .env eintragen
			if (TRANSPORT === 'legacy' && process.env.TWITCH_WEB_TOKEN) {
				console.warn('[pubsub] TWITCH_WEB_TOKEN abgelehnt (ERR_BADAUTH) - Mod-Themen kommen nicht an');
				return;
			}
			await invalidateUserToken();
			const token = await getToken();
			for (const slot of this.#slots) {
				slot.client.listen([...slot.topics], token);
			}
		} catch (e) {
			console.warn('[pubsub] Neuanmeldung fehlgeschlagen', e);
		} finally {
			this.#reauthenticating = false;
		}
	}

	#enqueue(topic) {
		if (this.#topicSlot.has(topic) || this.#queue.includes(topic)) {
			return;
		}

		this.#queue.push(topic);
		void this.#drain();
	}

	/** Gedrosselt abarbeiten, damit Hermes die Abo-Flut nicht abweist */
	async #drain() {
		if (this.#timer || this.#queue.length === 0) {
			return;
		}

		const topic = this.#queue.shift();
		if (!this.#topicSlot.has(topic)) {
			const slot = this.#slot();
			slot.topics.add(topic);
			this.#topicSlot.set(topic, slot);
			slot.client.listen(topic, await getToken());
		}

		if (this.#queue.length > 0) {
			this.#timer = setTimeout(() => {
				this.#timer = null;
				void this.#drain();
			}, SUBSCRIBE_DELAY);
		}
	}

	subscribeChannel(channel) {
		if (!channel.twitchId) {
			return;
		}

		for (const topic of channelTopics(this.#selfId, channel.twitchId)) {
			this.#enqueue(topic);
		}
	}

	unsubscribeChannel(channel) {
		if (!channel.twitchId) {
			return;
		}

		for (const topic of channelTopics(this.#selfId, channel.twitchId)) {
			const slot = this.#topicSlot.get(topic);
			slot?.client.unlisten(topic);
			slot?.topics.delete(topic);
			this.#topicSlot.delete(topic);
		}
	}

	/**
	 * Einzelnes Topic fuer einen nicht gejointen Broadcaster (Block 8: notify live = video-playback-by-id,
	 * titlenotify = broadcast-settings-update) - beide sind offen, ohne Mod-Rechte. Doppelte Abos werden uebersprungen.
	 */
	subscribeTopic(topic) {
		this.#enqueue(topic);
	}

	/** Nicht channelgebunden: Chatroom-Zustand des eigenen Kontos (z. B. wenn der Account irgendwo gebannt wird) */
	subscribeSelf() {
		if (this.#selfId) {
			this.#enqueue(`chatrooms-user-v1.${this.#selfId}`);
		}
	}

	#dispatch(topic, payload) {
		const platform = this.#platform;
		if (!platform) {
			return;
		}

		const { prefix, broadcasterId } = parseTopic(topic);
		const channel = prefix === 'chatrooms-user-v1' ? null : bot.Channels.getByTwitchId(broadcasterId);
		const base = { platform, channel, topic, broadcasterId, payload };

		if (LOG_RAW) {
			console.log(`[pubsub-raw] ${topic}: ${JSON.stringify(payload)}`);
		}

		bot.ChatModules.dispatchPubSub('raw', base);

		// Ohne EventSub kommt der Live-Status der gejointen Channels von hier
		const playback = prefix === 'video-playback-by-id' ? payload?.type : null;
		if (channel && (playback === 'stream-up' || playback === 'stream-down')) {
			platform.setStreamState(broadcasterId, playback === 'stream-up');
		}

		const event = PUBSUB_EVENTS[prefix];
		if (event) {
			bot.ChatModules.dispatchPubSub(event, base);
		}
	}

	status() {
		return {
			transport: TRANSPORT,
			connections: this.#slots.length,
			topics: this.#slots.reduce((sum, i) => sum + i.topics.size, 0),
		};
	}
}

const pubsub = new PubSub();

module.exports = { PUBSUB_EVENTS, channelTopics, parseTopic, pubsub };
