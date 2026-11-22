const { Logger } = require('../misc/logger.js');
const WebSocket = require('ws');

// Anonymer Live-Feed von CatQuery (https://docs.catquery.com/firehose/), aus sb-v2s
// v2/singletons/catquery-firehose.ts: Twitch-Chat samt IRC-Tags, darunter first-msg, das es weder ueber
// EventSub noch ueber GQL gibt. Drittanbieter ohne Garantie - deshalb immer mit Rueckfall auf die eigene
// Ableitung (chatter-registry.ts). Zuordnung ueber die Nachrichten-ID: id im Firehose == message_id in EventSub.
// Nur Nachrichten aus Channels des Bots (room-id) werden gemerkt, der Rest (~1.500/s) sofort verworfen.
// Limits laut Doku: 10 Verbindungen / 100 neue pro Minute je IP, "escalating temporary blocking" bei
// Verstoessen - daher genau eine Verbindung und exponentielles Backoff.

const URL_FIREHOSE = 'wss://firehose.catquery.com/firehose?json=true';
const TTL = 30_000;
const STALE = 45_000; // Server pingt alle 30 s - laenger nichts = tot
const BACKOFF_MIN = 2_000;
const BACKOFF_MAX = 120_000;
const HANDSHAKE_TIMEOUT = 15_000;

/** Usernotices, die EventSub (channel.chat.notification) nicht abdeckt: Mod-Jubilaeum, Zuschauer-Meilensteine */
const FORWARD_NOTICES = new Set(['modiversary', 'viewermilestone']);

// Eigenes Konto in fremden Nachrichten aller Channels, ins Log (alexmoderat, 09.11.2026): damit laesst sich nach einer
// Warnung nachsehen, was kurz davor lief, ohne Log-Seiten zu scannen. Geprueft wird die Rohnachricht, so zaehlen auch
// Antworten auf eigene Nachrichten (Reply-Tags).
const OWN_USER_ID = '1153381727';
const OWN_MENTION = /alexmoderat|1153381727/i;
const MENTION_TEXT_LIMIT = 300;

const logOwnMention = (raw, json, tags) => {
	if (String(tags['user-id'] ?? '') === OWN_USER_ID || !OWN_MENTION.test(raw)) {
		return;
	}

	const channel = String(json.channel ?? tags['room-id'] ?? '?').replace('#', '');
	const sender = String(tags['display-name'] || tags.login || json.user || '?');
	const text = String(json.text ?? json.message ?? raw).slice(0, MENTION_TEXT_LIMIT);
	Logger.info(`[catquery] Erwaehnung ${new Date().toISOString()} #${channel} ${sender}: ${text}`);
};

const firstFlags = new Map();
const noticeSeen = new Map();
const coverage = new Map();

let ws = null;
let isOurRoom = () => false;
let onNotice = null;
let onWatchStreak = null;
const watchStreakSeen = new Map();
let backoff = BACKOFF_MIN;
let lastMessageAt = 0;
let running = false;
let reconnectTimer = null;
let received = 0;
let kept = 0;

const handleMessage = (raw) => {
	lastMessageAt = Date.now();
	backoff = BACKOFF_MIN;
	received++;

	let json;
	try {
		json = JSON.parse(raw);
	} catch {
		return;
	}

	const tags = json.tags;
	if (!json.id || !tags || typeof tags !== 'object') {
		return;
	}

	logOwnMention(raw, json, tags);

	const id = String(json.id);
	const roomId = String(tags['room-id'] ?? '');

	// Watch-Streak-Meilensteine aus ALLEN Channels (ninou2, 06.10.2026: der Bot soll den hoechsten Streak ueberall sehen)
	if (onWatchStreak && tags['event-type'] === 'usernotice' && tags['msg-id'] === 'viewermilestone' && tags['msg-param-category'] === 'watch-streak' && !watchStreakSeen.has(id)) {
		watchStreakSeen.set(id, Date.now());
		if (watchStreakSeen.size > 20_000) {
			watchStreakSeen.clear();
		}

		const channel = String(json.channel ?? '')
			.replace('#', '')
			.toLowerCase();
		try {
			onWatchStreak({ roomId, channel, msgId: 'viewermilestone', tags, text: String(json.text ?? '') });
		} catch (e) {
			Logger.warn('[catquery] Watch-Streak-Fehler', e);
		}
	}

	if (!isOurRoom(roomId)) {
		return;
	}

	if (tags['event-type'] === 'usernotice') {
		const msgId = String(tags['msg-id'] ?? '');
		if (!onNotice || !FORWARD_NOTICES.has(msgId) || noticeSeen.has(id)) {
			return;
		}

		noticeSeen.set(id, Date.now());
		const channel = String(json.channel ?? '')
			.replace('#', '')
			.toLowerCase();
		if (channel) {
			try {
				onNotice({ roomId, channel, msgId, tags, text: String(json.text ?? '') });
			} catch (e) {
				Logger.warn('[catquery] Usernotice-Fehler', e);
			}
		}

		return;
	}

	kept++;
	firstFlags.set(id, { isFirst: String(tags['first-msg']) === '1', ts: Date.now() });
};

const connect = () => {
	if (!running) {
		return;
	}

	// Ohne Handshake-Timeout haengt ein nicht antwortender Server ewig (CatQuery-Ausfall 23.10.2026: weder open noch close)
	const socket = new WebSocket(URL_FIREHOSE, { headers: { 'User-Agent': 'alexmoderat-selfbot' }, handshakeTimeout: HANDSHAKE_TIMEOUT });
	ws = socket;

	socket.on('open', () => {
		lastMessageAt = Date.now();
		Logger.info('[catquery] Firehose verbunden');
	});
	socket.on('message', (data) => handleMessage(String(data)));
	socket.on('error', (e) => Logger.warn(`[catquery] Firehose-Fehler: ${e.message}`));
	socket.on('close', (code) => {
		if (ws === socket) {
			ws = null;
		}
		if (!running) {
			return;
		}

		Logger.warn(`[catquery] Firehose getrennt (${code}), neuer Versuch in ${Math.round(backoff / 1000)} s`);
		reconnectTimer = setTimeout(connect, backoff);
		backoff = Math.min(backoff * 2, BACKOFF_MAX);
	});
};

/** Startet den Feed (einmalig). ourRoom(roomId) filtert auf die Channels des Bots. */
const start = (ourRoom, noticeHandler, watchStreakHandler) => {
	if (running) {
		return;
	}

	running = true;
	isOurRoom = ourRoom;
	onNotice = noticeHandler ?? null;
	onWatchStreak = watchStreakHandler ?? null;
	connect();

	const timer = setInterval(() => {
		const now = Date.now();
		for (const [key, value] of firstFlags) {
			if (now - value.ts > TTL) {
				firstFlags.delete(key);
			}
		}
		for (const [key, ts] of noticeSeen) {
			if (now - ts > 10 * 60_000) {
				noticeSeen.delete(key);
			}
		}

		// Verbindung steht, aber es kommt nichts mehr -> abbrechen, der close-Handler verbindet neu.
		// Nur bei OFFENER Verbindung: sonst bricht der Vergleich mit der letzten Nachricht von VOR einem Ausfall jeden
		// neuen Handshake sofort ab (sb-v2 kam so nach dem CatQuery-Ausfall am 23.10.2026 nie wieder hoch)
		if (ws?.readyState === WebSocket.OPEN && now - lastMessageAt > STALE) {
			Logger.warn('[catquery] Firehose still, verbinde neu');
			ws.terminate();
		}
	}, 5_000);
	timer.unref();
};

const stop = () => {
	running = false;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
	}
	ws?.terminate();
};

/** Sofortiger Blick: true/false = Flag laut Firehose, null = (noch) nichts da */
const peek = (messageId) => firstFlags.get(messageId)?.isFirst ?? null;

/**
 * Wartet bis zu maxMs auf das Flag. Channels, fuer die der Firehose zuletzt mehrfach nichts lieferte,
 * warten nicht - sonst verzoegert jede Nachricht dort um die volle Zeit; alle 20 Nachrichten gibt es
 * trotzdem wieder ein Wartefenster, falls die Abdeckung zurueckkam.
 */
const waitFirst = async (channel, messageId, maxMs = 500) => {
	let cov = coverage.get(channel);
	if (!cov) {
		cov = { hit: 0, miss: 0, missStreak: 0 };
		coverage.set(channel, cov);
	}

	// Ohne offene Verbindung nicht warten (sb-v2 wartete schon, solange die Verbindung erst aufgebaut wurde)
	const skipWait = ws?.readyState !== WebSocket.OPEN || (cov.missStreak >= 5 && (cov.hit + cov.miss) % 20 !== 0);
	const deadline = Date.now() + (skipWait ? 0 : maxMs);
	let value = peek(messageId);
	while (value === null && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		value = peek(messageId);
	}

	if (value === null) {
		cov.miss++;
		cov.missStreak++;
	} else {
		cov.hit++;
		cov.missStreak = 0;
	}

	return value;
};

const stats = () => {
	let hit = 0;
	let miss = 0;
	const uncovered = [];
	for (const [channel, cov] of coverage) {
		hit += cov.hit;
		miss += cov.miss;
		if (cov.miss > 0 && cov.hit === 0) {
			uncovered.push(`#${channel}(${cov.miss})`);
		}
	}

	return { connected: ws?.readyState === WebSocket.OPEN, received, kept, hit, miss, uncovered };
};

/** Nur fuer Tests */
const _test = {
	handleMessage,
	setRooms: (fn) => {
		isOurRoom = fn;
	},
};

module.exports = { FORWARD_NOTICES, start, stop, peek, waitFirst, stats, _test };
