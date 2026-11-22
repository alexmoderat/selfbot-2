const { Logger } = require('../../misc/logger.js');
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const z = require('zod');

// Client fuer Twitchs "Hermes" (wss://hermes.twitch.tv/v1), aus sb-v2 (src/services/hermes-client.ts).
// Hermes ersetzt seit der PubSub-Abschaltung (14.04.2025) PubSub in der Twitch-Weboberflaeche:
// gleiche Topic-Namen (chat_moderator_actions.<uid>.<cid>, automod-queue, low-trust-users, ...) und Payloads.
// Protokoll (in sb-v2 am 25.09.2026 gegen den echten Endpunkt getestet):
//   - wss://hermes.twitch.tv/v1?clientId=<Web-Client-ID> (die eigene App-ID wird mit 4131 abgelehnt)
//   - Server -> welcome { keepaliveSec, recoveryUrl }; Client -> authenticate { token } mit normalem User-Token
//   - Client -> subscribe { id, type:"pubsub", pubsub:{ topic } }; Server -> notification { pubsub:"<JSON>" }
//   - Limit: 150 Abos je Verbindung
// Inoffiziell und undokumentiert.

const RAW_LOG_ENABLED = process.env.RAW_HERMES_LOG === '1';
const log = (message, level = 'info') => {
	const fn = level === 'error' ? Logger.error : level === 'warning' ? Logger.warn : Logger.info;
	fn(message);
};

const hermesResult = z.object({ result: z.string(), error: z.string().optional(), errorCode: z.string().optional() });
const hermesFrameSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('welcome'),
		welcome: z.object({ keepaliveSec: z.number().optional(), sessionId: z.string().optional(), recoveryUrl: z.string().optional() }),
	}),
	z.object({ type: z.literal('keepalive') }),
	z.object({ type: z.literal('reconnect') }),
	z.object({ type: z.literal('authenticateResponse'), authenticateResponse: hermesResult }),
	z.object({
		type: z.literal('subscribeResponse'),
		parentId: z.string().optional(),
		subscribeResponse: hermesResult.extend({ subscription: z.object({ id: z.string() }).optional() }),
	}),
	z.object({ type: z.literal('unsubscribeResponse') }),
	z.object({
		type: z.literal('notification'),
		notification: z.object({ subscription: z.object({ id: z.string() }), pubsub: z.string() }),
	}),
]);

const HERMES_URL = 'wss://hermes.twitch.tv/v1';
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // oeffentliche Client-ID der Twitch-Weboberflaeche
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RESUB_DELAY_MS = 50;
const KEEPALIVE_SLACK_MS = 2_500;
const HEALTH_CHECK_MS = 2_000;
const RECOVERY_ENABLED = false; // siehe _open()

/** Frames tragen das Token im Klartext (authenticate) — nie unredigiert loggen. */
function redact(raw) {
	return raw.replace(/("token":")[^"]*(")/, '$1[redacted]$2');
}

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(16).toString('base64url').slice(0, 21);

class HermesPubSubClient extends EventEmitter {
	_ws = null;
	_topics = new Map(); // topic → Token
	_topicToId = new Map(); // topic → Subscription-ID
	_idToTopic = new Map(); // Subscription-ID → topic
	_token = '';
	_welcomed = false;
	_ready = false; // authentifiziert
	_keepaliveMs = 12_500;
	_lastKeepalive = 0;
	_healthTimer = null;
	_reconnectAttempt = 0;
	_reconnectTimer = null;
	_manualClose = false;
	// Sitzungswiederherstellung: welcome liefert recoveryUrl + sessionId. Verbindet man sich
	// nach einem Abbruch darueber, bleiben Abos UND Anmeldung erhalten (25.09.2026 getestet:
	// Notifications kamen mit den alten Subscription-IDs weiter, ein geschuetztes Topic liess
	// sich ohne erneutes authenticate abonnieren).
	_recoveryUrl = '';
	_sessionId = '';
	_recovering = false; // aktuelle Verbindung wurde ueber recoveryUrl aufgebaut
	_recoveryFailed = false; // letzter Wiederherstellungsversuch ging schief → frisch verbinden

	constructor(_options) {
		super();
		this.setMaxListeners(0);
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
		return !!this._ws && this._ws.readyState === WebSocket.OPEN && this._ready;
	}

	// ── Verbindung ─────────────────────────────────────────────────────────────

	connect() {
		this._manualClose = false;
		this._open();
	}

	disconnect() {
		this._manualClose = true;
		this._clearTimers();
		this._ws?.close();
	}

	_open() {
		// Keine Sitzungswiederherstellung mehr (26.10.2026): nach der ersten Wiederherstellung kam in allen 341 Channels
		// kein Ereignis mehr an (letzter Bann 03:56 UTC, danach 11 h Stille, Spammer in #alex_sbottats nicht erfasst),
		// obwohl Hermes "Sitzung wiederhergestellt" meldete. Die Sitzung lief noch mit dem Token vom Start (~4 h gueltig).
		// Frisch verbinden meldet mit gueltigem Token neu an - ein abgelaufener wird abgelehnt und pubsub holt einen neuen.
		const recover = RECOVERY_ENABLED && !!this._recoveryUrl && !this._recoveryFailed;
		this._recovering = recover;
		this._welcomed = false;
		this._ready = false;
		if (!recover) {
			// Frische Sitzung: alte Abo-IDs sind ungueltig
			this._topicToId.clear();
			this._idToTopic.clear();
		}

		const url = recover ? this._recoveryUrl : `${HERMES_URL}?clientId=${WEB_CLIENT_ID}`;
		this._ws = new WebSocket(url, {
			headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.twitch.tv' },
		});
		const ws = this._ws;

		ws.on('message', (data) => this._receive(String(data)));

		ws.on('close', (code) => {
			this._clearTimers();
			this._ready = false;
			// Schlug die Wiederherstellung fehl (schloss vor dem welcome), naechstes Mal frisch
			if (this._recovering && !this._welcomed) {
				this._recoveryFailed = true;
				log(`[Hermes] Wiederherstellung fehlgeschlagen (Code ${code}), naechster Versuch frisch`, 'warning');
			}
			const wasManual = this._manualClose;
			if (!wasManual && code === 4131) log('[Hermes] Verbindung abgelehnt (4131) — ungueltige Client-ID?', 'warning');
			this.emit('disconnect', !wasManual);
			if (!wasManual) this._scheduleReconnect();
		});

		ws.on('error', (err) => log(`[Hermes] WebSocket-Fehler: ${err.message}`, 'warning'));
	}

	_scheduleReconnect() {
		if (this._reconnectTimer) return;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._reconnectAttempt, RECONNECT_MAX_MS);
		this._reconnectAttempt++;
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this._open();
		}, delay);
	}

	_clearTimers() {
		if (this._healthTimer) clearInterval(this._healthTimer);
		this._healthTimer = null;
	}

	_startHealth() {
		this._clearTimers();
		this._lastKeepalive = Date.now();
		this._healthTimer = setInterval(() => {
			if (Date.now() - this._lastKeepalive > this._keepaliveMs) {
				log('[Hermes] Kein Keepalive, verbinde neu', 'warning');
				this._ws?.terminate?.() ?? this._ws?.close();
			}
		}, HEALTH_CHECK_MS);
		this._healthTimer.unref?.();
	}

	// ── Senden ─────────────────────────────────────────────────────────────────

	_send(packet) {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
		const raw = JSON.stringify(packet);
		if (RAW_LOG_ENABLED) Logger.info(`[hermes >] ${redact(raw)}`);
		this._ws.send(raw);
	}

	_authenticate() {
		if (!this._token || this._ready) return;
		this._send({ type: 'authenticate', id: newId(), timestamp: nowIso(), authenticate: { token: this._token } });
	}

	_sendSubscribe(topic) {
		if (!this.isConnected || this._topicToId.has(topic)) return;
		const id = newId();
		this._topicToId.set(topic, id);
		this._idToTopic.set(id, topic);
		this._send({ type: 'subscribe', id, timestamp: nowIso(), subscribe: { id, type: 'pubsub', pubsub: { topic } } });
	}

	listen(topics, tokenResolvable) {
		const list = Array.isArray(topics) ? topics : [topics];
		const token = typeof tokenResolvable === 'string' ? tokenResolvable : String(tokenResolvable ?? '');
		if (token) this._token = token;
		for (const t of list) this._topics.set(t, token || this._token);

		if (this.isConnected) for (const t of list) this._sendSubscribe(t);
		else if (this._welcomed && !this._ready) this._authenticate(); // welcome kam schon, Token fehlte noch
	}

	unlisten(topics) {
		const list = Array.isArray(topics) ? topics : [topics];
		for (const topic of list) {
			this._topics.delete(topic);
			const id = this._topicToId.get(topic);
			if (!id || !this.isConnected) continue;
			this._send({ type: 'unsubscribe', id: newId(), timestamp: nowIso(), unsubscribe: { id, type: 'pubsub', pubsub: { topic } } });
			this._topicToId.delete(topic);
			this._idToTopic.delete(id);
		}
	}

	/** Nach (Re-)Authentifizierung alle Topics gedrosselt anmelden. */
	_resendAll() {
		const topics = [...this._topics.keys()].filter((t) => !this._topicToId.has(t)); // nur, was noch keine ID hat
		let i = 0;
		const step = () => {
			if (i >= topics.length || !this.isConnected) return;
			this._sendSubscribe(topics[i++]);
			if (i < topics.length) setTimeout(step, RESUB_DELAY_MS);
		};
		step();
	}

	// ── Empfangen ──────────────────────────────────────────────────────────────

	_receive(raw) {
		if (RAW_LOG_ENABLED) Logger.info(`[hermes <] ${redact(raw)}`);
		let json;
		try {
			json = JSON.parse(raw);
		} catch {
			return;
		}
		// Unbekannte oder fehlgeformte Frames ignorieren (Hermes ist undokumentiert und kann
		// neue Arten einfuehren) — bekannte werden fuer den Rest der Funktion typisiert.
		const parsed = hermesFrameSchema.safeParse(json);
		if (!parsed.success) return;
		const f = parsed.data;

		// Jede Nachricht ist ein Lebenszeichen: der Server schickt Keepalives offenbar
		// nur bei Stille (beim Anmelden von ~140 Topics kamen keine, obwohl die
		// Verbindung lebt — 25.09.2026 sonst 7 unnoetige Reconnects in der ersten Minute).
		this._lastKeepalive = Date.now();

		switch (f.type) {
			case 'welcome': {
				this._welcomed = true;
				const w = f.welcome;
				const sec = w.keepaliveSec || 10;
				this._keepaliveMs = sec * 1000 + KEEPALIVE_SLACK_MS;
				this._startHealth();

				const newSession = w.sessionId ?? '';
				const resumed = this._recovering && !!newSession && newSession === this._sessionId;
				if (w.recoveryUrl) this._recoveryUrl = w.recoveryUrl; // jede Begruessung bringt eine frische URL
				this._sessionId = newSession;

				if (resumed) {
					// Sitzung wiederhergestellt: Anmeldung und Abos bestehen weiter
					this._recoveryFailed = false;
					this._ready = true;
					this._reconnectAttempt = 0;
					log(`[Hermes] Sitzung wiederhergestellt (${this._topicToId.size} Abos)`, 'info');
					this.emit('connect');
					this._resendAll(); // nur Topics, die waehrend der Luecke dazukamen (Rest hat schon eine ID)
				} else {
					if (this._recovering) {
						// Wiederherstellung angenommen, aber neue Sitzung → wie frisch behandeln
						this._topicToId.clear();
						this._idToTopic.clear();
					}
					this._recoveryFailed = false;
					this._authenticate(); // ohne Token: wartet auf das erste listen()
				}
				return;
			}
			case 'keepalive':
				this._lastKeepalive = Date.now();
				return;
			case 'reconnect':
				// Server bittet um Neuverbindung
				this._ws?.close();
				return;
			case 'authenticateResponse': {
				const r = f.authenticateResponse;
				if (r.result === 'ok') {
					this._ready = true;
					this._reconnectAttempt = 0;
					this.emit('connect');
					this._resendAll();
				} else {
					const err = new Error(`Hermes-Anmeldung fehlgeschlagen: ${r.error ?? r.result ?? '?'} ${r.errorCode ?? ''}`.trim());
					log(`[Hermes] ${err.message}`, 'error');
					for (const t of this._topics.keys()) this.emit('listenError', t, err, false);
				}
				return;
			}
			case 'subscribeResponse': {
				const r = f.subscribeResponse;
				const parentId = f.parentId ?? '';
				const topic = this._idToTopic.get(parentId) ?? (r.subscription ? this._idToTopic.get(r.subscription.id) : undefined);
				if (r.result === 'ok') {
					const sid = r.subscription?.id;
					if (topic && sid) {
						this._idToTopic.set(sid, topic);
						this._topicToId.set(topic, sid);
					}
				} else if (topic) {
					this._idToTopic.delete(parentId);
					this._topicToId.delete(topic);
					this.emit('listenError', topic, new Error(`${r.error ?? 'error'} ${r.errorCode ?? ''}`.trim()), true);
				}
				return;
			}
			case 'notification': {
				const n = f.notification;
				const topic = this._idToTopic.get(n.subscription.id);
				if (!topic) return;
				let message = n.pubsub;
				try {
					message = JSON.parse(n.pubsub);
				} catch {
					/* bleibt String */
				}
				this.emit('message', topic, message);
				return;
			}
		}
	}
}

module.exports = { hermesFrameSchema, HermesPubSubClient };
