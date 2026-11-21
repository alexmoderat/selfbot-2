const WS = require('ws');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const RWS = require('reconnecting-websocket');
const { Logger, LogLevel } = require('../../misc/logger.js');

// Twitchs altes PubSub (wss://pubsub-edge.twitch.tv/v1) wie bei DontAddThisBot: reconnecting-websocket, PING alle
// 250 s, LISTEN je Thema mit eigenem nonce, 50 Themen je Verbindung. Offiziell seit April 2025 abgeschaltet,
// liefert aber weiter Ereignisse (getestet 07.11.2026: video-playback-by-id; Mod-Themen nur mit Web-Token).
// Gleiche Schnittstelle wie hermes-client.js (connect, listen, unlisten, onMessage, onListenError, onConnect),
// damit services/pubsub.js zwischen beiden waehlen kann.

const PUBSUB_URL = 'wss://pubsub-edge.twitch.tv/v1';
const PING_INTERVAL = 250 * 1000;
const MAX_TOPICS = 50;

let connectionId = 0;

class LegacyPubSubClient extends EventEmitter {
	#ws = null;
	#id = ++connectionId;
	#topics = new Map(); // topic -> Token
	#nonces = new Map(); // nonce -> topic
	#confirmed = new Set();
	#pingTimer = null;

	static get MAX_TOPICS() {
		return MAX_TOPICS;
	}

	onMessage(cb) {
		this.on('message', cb);
	}
	onListenError(cb) {
		this.on('listenError', cb);
	}
	onConnect(cb) {
		this.on('connect', cb);
	}
	onDisconnect(cb) {
		this.on('disconnect', cb);
	}

	get isConnected() {
		return this.#ws?.readyState === WS.OPEN;
	}

	connect() {
		const ws = new RWS(PUBSUB_URL, [], { WebSocket: WS, startClosed: true });
		this.#ws = ws;

		ws.addEventListener('error', (e) => Logger.log(LogLevel.ERROR, e.message ?? e));
		ws.addEventListener('close', () => {
			this.#confirmed.clear();
			this.emit('disconnect', true);
			Logger.log(LogLevel.WARN, `[${this.#id}] PubSub Disconnected`);
		});
		ws.addEventListener('open', () => {
			Logger.log(LogLevel.DEBUG, `[${this.#id}] PubSub Connected`);
			for (const topic of this.#topics.keys()) {
				this.#sendListen(topic);
			}
			this.emit('connect');
		});
		ws.addEventListener('message', ({ data }) => this.#handle(data));

		this.#pingTimer = setInterval(() => {
			if (this.isConnected) {
				ws.send(JSON.stringify({ type: 'PING' }));
			}
		}, PING_INTERVAL);
		this.#pingTimer.unref();

		ws.reconnect();
	}

	listen(topics, token) {
		const list = Array.isArray(topics) ? topics : [topics];
		for (const topic of list) {
			const known = this.#topics.get(topic);
			this.#topics.set(topic, token || known || '');
			// Schon bestaetigte Themen nicht erneut anmelden (regelmaessige Token-Auffrischung)
			if (this.isConnected && !this.#confirmed.has(topic)) {
				this.#sendListen(topic);
			}
		}
	}

	unlisten(topics) {
		const list = Array.isArray(topics) ? topics : [topics];
		for (const topic of list) {
			const token = this.#topics.get(topic);
			this.#topics.delete(topic);
			this.#confirmed.delete(topic);
			if (this.isConnected) {
				this.#ws.send(JSON.stringify({ type: 'UNLISTEN', nonce: this.#nonce(topic), data: { topics: [topic], auth_token: token } }));
			}
		}
	}

	#nonce(topic) {
		const nonce = crypto.randomBytes(20).toString('hex').slice(-8);
		this.#nonces.set(nonce, topic);
		return nonce;
	}

	#sendListen(topic) {
		const token = this.#topics.get(topic);
		this.#ws.send(JSON.stringify({ type: 'LISTEN', nonce: this.#nonce(topic), data: { topics: [topic], ...(token ? { auth_token: token } : {}) } }));
	}

	#handle(raw) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		switch (msg.type) {
			case 'PONG':
				return;
			case 'RESPONSE': {
				const topic = this.#nonces.get(msg.nonce);
				this.#nonces.delete(msg.nonce);
				if (!topic) {
					return;
				}
				if (msg.error) {
					// ERR_BADAUTH = Token abgelehnt (userInitiated false wie bei Hermes -> neu anmelden)
					this.emit('listenError', topic, new Error(msg.error), msg.error !== 'ERR_BADAUTH');
				} else {
					this.#confirmed.add(topic);
				}
				return;
			}
			case 'MESSAGE': {
				if (!msg.data) {
					Logger.log(LogLevel.ERROR, `No data associated with message [${JSON.stringify(msg)}]`);
					return;
				}
				let message;
				try {
					message = JSON.parse(msg.data.message);
				} catch {
					message = msg.data.message;
				}
				this.emit('message', msg.data.topic, message);
				return;
			}
			case 'RECONNECT':
				Logger.log(LogLevel.WARN, `[${this.#id}] PubSub server sent a reconnect message. Restarting the socket`);
				this.#ws.reconnect();
				return;
			default:
				Logger.log(LogLevel.ERROR, `Unknown PubSub Message Type: ${msg.type}`);
		}
	}

	close() {
		clearInterval(this.#pingTimer);
		this.#ws?.close();
	}
}

module.exports = { LegacyPubSubClient, PUBSUB_URL };
