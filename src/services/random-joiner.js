const WebSocket = require('ws');

const { helix } = require('../token/helix.js');
const { Logger, LogLevel } = require('../misc/logger.js');

/**
 * Joiner wie DontAddThisBots trash/BrokenCommands/joiner (alexmoderat, 11.11.2026: "kannst du mir son joiner machen wie
 * don't"): zufaellige kleine Live-Channels mitlesen. Statt anonymem IRC ueber EventSub channel.chat.message mit dem
 * Bot-Token ("Nur Nachrichten" - keine JOIN/PART-Anwesenheit, die gibt es in EventSub nicht).
 *
 * Twitch-Limits (dev.twitch.tv/docs/chat, Stand 11.11.2026):
 * - hoechstens 100 Chats gleichzeitig je Account, IRC-Joins zaehlen mit; Channels mit Mod-/Broadcaster-Rechten nicht.
 *   Deshalb: Plaetze = 100 - Nicht-Mod-Channels im IRC - Reserve.
 * - 20 Joins je 10 s (ein Abo = ein Join) -> Abstand JOIN_GAP.
 * - je WebSocket 300 Abos; eigener Socket, der von util/twitch/eventSub.js ist mit channel.follow schon belegt.
 * Rotation ("muessen wir zwar rotieren"): alle ROTATE_INTERVAL offline gegangene Channels raus und die aeltesten
 * ROTATE_SHARE ersetzen. Nachrichten landen in joinerMessages (7 Tage, TTL-Index).
 */

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const JOIN_LIMIT = 100;
const RESERVE = 5;
const JOIN_GAP = 1_000;
const ROTATE_INTERVAL = 10 * 60_000;
const ROTATE_SHARE = 0.25;
const FLUSH_INTERVAL = 60_000;
const MAX_BUFFER = 20_000;
const SKIP_PAGES_MAX = 40;
const POOL_PAGES = 3;

const envNumber = (name, fallback) => {
	const value = Number.parseInt(process.env[name] ?? '', 10);
	return Number.isFinite(value) ? value : fallback;
};

/** Freie Plaetze: gewuenschte Zahl, aber nie ueber das Join-Limit abzueglich der Nicht-Mod-IRC-Channels */
const computeSlots = (wanted, nonModJoined) => Math.max(0, Math.min(wanted, JOIN_LIMIT - RESERVE - nonModJoined));

/**
 * Kandidaten aus Helix-Streams: Zuschauer im Bereich, nicht schon gejoint/belegt, zufaellig gemischt
 * @param {Array<{ user_id: string, user_login: string, viewer_count: number }>} streams
 */
const pickCandidates = (streams, { exclude, minViewers, maxViewers, count, random = Math.random }) => {
	const seen = new Set();
	const pool = streams.filter((s) => {
		if (seen.has(s.user_id) || exclude.has(s.user_id) || s.viewer_count < minViewers || s.viewer_count > maxViewers) {
			return false;
		}
		seen.add(s.user_id);
		return true;
	});
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, count);
};

/** Welche Channels fliegen raus: alle offline gegangenen, dazu die aeltesten bis ROTATE_SHARE erreicht ist */
const selectRotation = (entries, liveIds, share = ROTATE_SHARE) => {
	const offline = entries.filter((i) => !liveIds.has(i.id));
	const online = entries.filter((i) => liveIds.has(i.id)).sort((a, b) => a.joinedAt - b.joinedAt);
	const extra = Math.max(0, Math.ceil(entries.length * share) - offline.length);
	return [...offline, ...online.slice(0, extra)];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let socket = null;
let sessionId = null;
let watchdog = null;
let reconnectDelay = 1000;
let stopped = true;
let rotateTimer = null;
let flushTimer = null;
let busy = false;
let limitHit = false;
let received = 0;
const joined = new Map(); // broadcasterId -> { id, login, subscriptionId, joinedAt, messages }
let buffer = [];

const settings = () => ({
	wanted: envNumber('JOINER_CHANNELS', 75),
	minViewers: envNumber('JOINER_MIN_VIEWERS', 1),
	maxViewers: envNumber('JOINER_MAX_VIEWERS', 1000),
});

const nonModJoined = () => bot.Channels.getJoinable().filter((i) => i.mode !== 'Moderator' && i.twitchId !== bot.Twitch.selfId).length;

/** Helix-Streams seitenweise (absteigend nach Zuschauern): ab dem Bereich zufaellig tief springen, dann ein Pool */
const fetchStreams = async ({ maxViewers }) => {
	const streams = [];
	let cursor = null;
	let skip = Math.floor(Math.random() * (SKIP_PAGES_MAX + 1));
	let collected = 0;
	for (let page = 0; page < 200; page++) {
		const response = await helix('streams', { app: true, searchParams: { first: 100, ...(cursor ? { after: cursor } : {}) } });
		if (!response.ok) {
			throw new Error(`Helix streams ${response.statusCode}`);
		}
		const data = response.body?.data ?? [];
		cursor = response.body?.pagination?.cursor ?? null;
		const inRange = data.length > 0 && data[data.length - 1].viewer_count <= maxViewers;
		if (inRange && skip > 0) {
			skip--;
		} else if (inRange) {
			streams.push(...data);
			collected++;
		}
		if (collected >= POOL_PAGES || !cursor || data.length === 0) {
			break;
		}
	}
	return streams;
};

/** Welche der gejointen Channels sind noch live (Helix, 100 IDs je Aufruf) */
const fetchLiveIds = async (ids) => {
	const live = new Set();
	for (let i = 0; i < ids.length; i += 100) {
		const chunk = ids.slice(i, i + 100);
		const response = await helix('streams', { app: true, searchParams: { user_id: chunk, first: 100 } });
		if (!response.ok) {
			throw new Error(`Helix streams ${response.statusCode}`);
		}
		for (const s of response.body?.data ?? []) {
			live.add(s.user_id);
		}
	}
	return live;
};

const subscribe = async (stream) => {
	const response = await helix('eventsub/subscriptions', {
		method: 'POST',
		json: {
			type: 'channel.chat.message',
			version: '1',
			condition: { broadcaster_user_id: stream.user_id, user_id: bot.Twitch.selfId },
			transport: { method: 'websocket', session_id: sessionId },
		},
	});
	if (!response.ok) {
		const message = response.body?.message ?? '';
		Logger.log(LogLevel.WARN, `[joiner] #${stream.user_login} fehlgeschlagen (${response.statusCode}): ${message}`);
		// 429 = Join-/Abo-Limit: nicht weiter fuellen bis zur naechsten Rotation
		if (response.statusCode === 429) {
			limitHit = true;
		}
		return false;
	}
	joined.set(stream.user_id, {
		id: stream.user_id,
		login: stream.user_login,
		subscriptionId: response.body?.data?.[0]?.id,
		joinedAt: Date.now(),
		messages: 0,
	});
	return true;
};

const unsubscribe = async (entry) => {
	joined.delete(entry.id);
	if (entry.subscriptionId) {
		await helix('eventsub/subscriptions', { method: 'DELETE', searchParams: { id: entry.subscriptionId }, responseType: 'text' }).catch(() => {});
	}
};

/** Offline/aelteste raus, freie Plaetze mit neuen Zufalls-Channels fuellen */
const rotate = async ({ initial = false } = {}) => {
	if (busy || !sessionId) {
		return;
	}
	busy = true;
	limitHit = false;
	try {
		const { wanted, minViewers, maxViewers } = settings();
		const slots = computeSlots(wanted, nonModJoined());

		let removed = 0;
		if (!initial && joined.size > 0) {
			const liveIds = await fetchLiveIds([...joined.keys()]);
			for (const entry of selectRotation([...joined.values()], liveIds)) {
				await unsubscribe(entry);
				removed++;
			}
		}
		// Plaetze geschrumpft (mehr Nicht-Mod-Channels im IRC): ueberzaehlige abgeben
		while (joined.size > slots) {
			await unsubscribe(joined.values().next().value);
			removed++;
		}

		const missing = slots - joined.size;
		let added = 0;
		if (missing > 0) {
			const exclude = new Set([
				...joined.keys(),
				...bot.Channels.getJoinable()
					.map((i) => i.twitchId)
					.filter(Boolean),
			]);
			const candidates = pickCandidates(await fetchStreams({ maxViewers }), { exclude, minViewers, maxViewers, count: missing });
			for (const stream of candidates) {
				if (!sessionId || limitHit) {
					break;
				}
				if (await subscribe(stream)) {
					added++;
				}
				await sleep(JOIN_GAP);
			}
		}
		Logger.log(LogLevel.INFO, `[joiner] ${joined.size}/${slots} Channel(s), +${added} -${removed}`);
	} catch (e) {
		Logger.log(LogLevel.WARN, '[joiner] Rotation fehlgeschlagen', e);
	} finally {
		busy = false;
	}
};

const flush = async () => {
	if (buffer.length === 0) {
		return;
	}
	const records = buffer;
	buffer = [];
	await bot.DB.JoinerMessage.insertMany(records, { ordered: false }).catch((e) => Logger.log(LogLevel.WARN, '[joiner] Speichern fehlgeschlagen', e));
};

const handleChatMessage = (event) => {
	received++;
	const entry = joined.get(String(event.broadcaster_user_id));
	if (entry) {
		entry.messages++;
	}
	if (buffer.length >= MAX_BUFFER) {
		return;
	}
	buffer.push({
		channelId: String(event.broadcaster_user_id),
		channel: String(event.broadcaster_user_login),
		userId: String(event.chatter_user_id),
		user: String(event.chatter_user_login),
		text: String(event.message?.text ?? '').slice(0, 500),
		messageId: event.message_id,
		posted: new Date(),
	});
};

const resetWatchdog = (seconds) => {
	clearTimeout(watchdog);
	watchdog = setTimeout(
		() => {
			Logger.log(LogLevel.WARN, '[joiner] Kein Keepalive, neue Verbindung');
			socket?.terminate();
		},
		(seconds + 10) * 1000,
	);
};

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
					previous?.removeAllListeners('close');
					previous?.close();
				} else {
					// Abos haengen an der Session: neue Verbindung = alles neu
					joined.clear();
					Logger.log(LogLevel.INFO, '[joiner] Verbunden');
					void rotate({ initial: true });
				}
				break;
			}
			case 'session_reconnect':
				connect(payload.session.reconnect_url, true);
				break;
			case 'notification':
				if (payload.subscription?.type === 'channel.chat.message') {
					handleChatMessage(payload.event);
				}
				break;
			case 'revocation': {
				const id = payload.subscription?.condition?.broadcaster_user_id;
				const entry = joined.get(id);
				joined.delete(id);
				Logger.log(LogLevel.INFO, `[joiner] #${entry?.login ?? id} widerrufen (${payload.subscription?.status})`);
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
		joined.clear();
		if (stopped) {
			return;
		}
		Logger.log(LogLevel.WARN, `[joiner] Verbindung zu (${code}), neuer Versuch in ${reconnectDelay / 1000}s`);
		setTimeout(() => connect(), reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
	});

	ws.on('error', (e) => Logger.log(LogLevel.WARN, `[joiner] ${e.message}`));
	if (!socket) {
		socket = ws;
	}
};

const start = () => {
	if (!stopped) {
		return;
	}
	stopped = false;
	connect();
	rotateTimer = setInterval(() => void rotate(), ROTATE_INTERVAL);
	rotateTimer.unref();
	flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL);
	flushTimer.unref();
};

const stop = async () => {
	stopped = true;
	clearInterval(rotateTimer);
	clearInterval(flushTimer);
	clearTimeout(watchdog);
	socket?.close();
	await flush();
};

/** Fuer eval/Dashboard */
const status = () => ({
	connected: Boolean(sessionId),
	received,
	slots: computeSlots(settings().wanted, nonModJoined()),
	channels: [...joined.values()].map(({ login, joinedAt, messages }) => ({ login, joinedAt: new Date(joinedAt), messages })),
});

module.exports = { start, stop, status, rotate, flush, computeSlots, pickCandidates, selectRotation };
