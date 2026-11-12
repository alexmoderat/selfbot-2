const { got } = require('../token/got.js');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { fmtLengthShort } = require('../misc/streamer-streak.js');
const { pubsub } = require('./pubsub.js');

/**
 * Benachrichtigungen, aus sb-v2s singletons/notifications.ts:
 *   live  - Streamer geht an/aus (PubSub video-playback-by-id), Ansage in den eingetragenen Channels
 *   title - Streamer aendert den Titel (broadcast-settings-update), Ping an die Abonnenten (titlenotify)
 *   ban   - Account bekommt einen Twitch-Ban (crons/ban-watch)
 * Die Streamer muessen weder gejoint noch gemoddet sein. sb-v2s via_bot (Haupt-/Utility-Bot) entfaellt - ein Bot.
 */

// Doppelte stream-up/-down-Meldungen unterdruecken; 60 s statt 5 min, damit echtes schnelles Flackern durchkommt
// (ninou2, 27.08.2026: zweite Offline-Meldung kam nie)
const DEDUPE_MS = 60_000;
const TITLE_RETRIES = 8;
const TITLE_RETRY_MS = 2000;

const lastOnline = new Map();
const lastOffline = new Map();

/* ---------- Abos ---------- */

const watchStreamer = (streamerId) => pubsub.subscribeTopic(`video-playback-by-id.${streamerId}`);
const watchTitle = (streamerId) => pubsub.subscribeTopic(`broadcast-settings-update.${streamerId}`);

/** Alle hinterlegten Streamer abonnieren (Start und crons/notify-resync); doppelte Topics ueberspringt pubsub */
const subscribeAll = async () => {
	const live = await bot.DB.NotifyLive.distinct('streamerId');
	const title = await bot.DB.TitleNotify.distinct('streamerId');

	// Kategoriewechsel fuer "games played" kommen ueber broadcast-settings - auch fuer notify-live-Streamer
	for (const id of live) {
		watchStreamer(id);
		watchTitle(id);
	}
	for (const id of title) {
		watchTitle(id);
	}

	return { live: live.length, title: title.length };
};

/* ---------- Texte (rein, getestet) ---------- */

/** "3h 12min", unter einer Stunde mit Sekunden (ninou2, 27.08.2026) */
const formatNotifyDuration = (ms) => {
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	const parts = [];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}min`);
	if (s && !h) parts.push(`${s}s`);
	return parts.join(' ') || '0min';
};

/**
 * "[Slay the Spire II] 1h [Gamble with your friends] 6h 3min" aus Startspiel und Wechseln (ninou2, 03./05.10.2026);
 * ohne echten Wechsel null - sonst stuende dieselbe Dauer zweimal da (ninou2, 13.10.2026)
 */
const gamesPlayedText = (startedMs, startGame, changes, now = Date.now()) => {
	if (changes.length === 0) {
		return null;
	}

	const segments = [
		{ game: startGame ?? 'no category', startMs: startedMs },
		...changes.map((i) => ({ game: i.game ?? 'no category', startMs: i.changedMs })),
	];
	const totals = new Map();
	segments.forEach((segment, i) => {
		const end = i + 1 < segments.length ? segments[i + 1].startMs : now;
		totals.set(segment.game, (totals.get(segment.game) ?? 0) + Math.max(0, end - segment.startMs));
	});

	const parts = [];
	for (const [game, ms] of totals) {
		const min = Math.floor(ms / 60_000);
		if (min < 1) {
			continue;
		}
		const h = Math.floor(min / 60);
		const m = min % 60;
		parts.push(`[${game}] ${min < 60 ? `${min}min` : m ? `${h}h ${m}min` : `${h}h`}`);
	}

	return parts.length > 0 ? parts.join(' ') : null;
};

/** "Streaming (Kategorie) : Titel" (ninou2, 13.10.2026: "say the category between ( )") */
const formatStreamingPart = (info) => (info.gameName ? `Streaming (${info.gameName}) : ${info.title}` : info.title);

// Streamer mit @ wie bei der Live-Meldung (ninou2, 10.11.2026: "the offline message @ people too")
const formatOfflineText = (login, gamesPart, lastGame, durationMs) => {
	const durationPart = durationMs !== null ? ` ⏱️They streamed for ${formatNotifyDuration(durationMs)} ⏱️` : '';
	return gamesPart
		? `@${login} is now offline! games played: ${gamesPart}.${durationPart}`
		: `@${login} is now offline!${lastGame ? ` Last game played: [${lastGame}].` : ''}${durationPart}`;
};

// Leerzeichen in den Anfuehrungszeichen, damit Emotes am Titelrand erkannt werden; Streamer mit @.
// Live: wie lange schon (ninou2, 10.11.2026: "if the streamer [is live] it tells for how long [they] has been [live]",
// "(Category: World of Warcraft) [⏱1h20min]", 12.11.2026 auf "[at ⏱1h20min]" geaendert (ninou2 tippt es so vor); "if the streamer offline this bracket part does not show")
const formatTitleChange = (users, login, title, game, liveMs = null) =>
	`${users.map((i) => `@${i}`).join(' ')} — @${login} changed their title: " ${title.trim()} "${game ? ` (Category: ${game})` : ''}${liveMs !== null ? ` [at ⏱${fmtLengthShort(liveMs)}]` : ''}`;

/** Seit wann live (ms), offline/unbekannt null */
const fetchLiveSince = async (streamerId) => {
	const response = await got('Helix')({ url: 'streams', searchParams: { user_id: streamerId } }).catch(() => null);
	const startedAt = response?.ok ? response.body.data[0]?.started_at : undefined;
	const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
	return Number.isNaN(startedMs) ? null : Math.max(0, Date.now() - startedMs);
};

/* ---------- live ---------- */

/** [{ Channel, Streamer_Login, Message }] */
const getEntries = async (streamerId) =>
	(await bot.DB.NotifyLive.find({ streamerId }, { channel: 1, streamerLogin: 1, message: 1 }).lean()).map((i) => ({
		Channel: i.channel,
		Streamer_Login: i.streamerLogin,
		Message: i.message,
	}));

const sendTo = async (channelId, text) => {
	const channel = bot.Channels.get(channelId);
	if (channel && channel.mode !== 'Inactive') {
		await bot.Channels.send(channel, text).catch((e) => console.warn(`[notifications] #${channel.name}`, e));
	}
};

/**
 * Titel direkt von Twitch, mit Wiederholung: das PubSub-Event kommt oft vor Helix /streams (ninou2, 01.08.2026),
 * bis zu ~14 s. Laeuft im Hintergrund, die Live-Ansage wartet nicht darauf (ninou2, 13.10.2026: "20-30s")
 */
const fetchLiveStreamInfo = async (streamerId) => {
	for (let attempt = 1; attempt <= TITLE_RETRIES; attempt++) {
		const response = await got('Helix')({
			url: 'streams',
			searchParams: { user_id: streamerId },
		}).catch(() => null);

		const stream = response?.ok ? response.body.data[0] : undefined;
		if (stream?.title) {
			return { title: stream.title, gameName: stream.game_name || null };
		}
		if (attempt < TITLE_RETRIES) {
			await new Promise((resolve) => setTimeout(resolve, TITLE_RETRY_MS));
		}
	}
	return null;
};

const announceStreamState = async (streamerId, isOnline) => {
	const seen = isOnline ? lastOnline : lastOffline;
	const last = seen.get(streamerId);
	if (last && Date.now() - last < DEDUPE_MS) {
		return;
	}
	seen.set(streamerId, Date.now());

	const entries = await getEntries(streamerId);
	if (entries.length === 0) {
		return;
	}

	const login = entries[0].Streamer_Login;
	if (isOnline) {
		// Start in der DB, damit die Offline-Ansage einen Neustart uebersteht (ninou2, 27./28.08.2026)
		await bot.DB.NotifyStreamState.updateOne({ streamerId }, { $set: { started: new Date(), game: null } }, { upsert: true });
		await bot.DB.NotifyGameChange.deleteMany({ streamerId });

		for (const entry of entries) {
			await sendTo(entry.Channel, `@${login} is now live!${entry.Message ? ` ${entry.Message}` : ''}`);
		}
		console.log(`[notifications] ${login} live -> ${entries.length} Channel(s)`);

		void fetchLiveStreamInfo(streamerId)
			.then(async (info) => {
				if (!info) {
					return;
				}
				await bot.DB.NotifyStreamState.updateOne({ streamerId }, { $set: { game: info.gameName || null } }).catch(() => {});
				for (const entry of entries) {
					await sendTo(entry.Channel, `@${login}: ${formatStreamingPart(info)}`);
				}
			})
			.catch(() => {});
		return;
	}

	const state = await bot.DB.NotifyStreamState.findOne({ streamerId }).lean();
	const changes = state ? await bot.DB.NotifyGameChange.find({ streamerId }).sort({ changed: 1 }).lean() : [];
	await bot.DB.NotifyStreamState.deleteOne({ streamerId });
	await bot.DB.NotifyGameChange.deleteMany({ streamerId });

	const startedMs = state?.started ? new Date(state.started).valueOf() : null;
	const gamesPart =
		startedMs !== null
			? gamesPlayedText(
					startedMs,
					state?.game ?? null,
					changes.map((i) => ({ changedMs: new Date(i.changed).valueOf(), game: i.game })),
				)
			: null;
	const text = formatOfflineText(login, gamesPart, state?.game ?? null, startedMs !== null ? Date.now() - startedMs : null);
	for (const entry of entries) {
		await sendTo(entry.Channel, text);
	}
	console.log(`[notifications] ${login} offline -> ${entries.length} Channel(s)`);
};

/** Kategoriewechsel waehrend eines laufenden notify-live-Streams merken */
const recordGameChange = async (streamerId, game) => {
	if (await bot.DB.NotifyStreamState.exists({ streamerId })) {
		await bot.DB.createWithId('NotifyGameChange', { streamerId, game: game || null, changed: new Date() });
	}
};

/* ---------- title ---------- */

const announceTitleChange = async (streamerId, title, game) => {
	const rows = (await bot.DB.TitleNotify.find({ streamerId }).lean()).map((i) => ({
		Channel: i.channel,
		Streamer_Login: i.streamerLogin,
		User_Alias: i.userAlias,
	}));
	if (rows.length === 0) {
		return;
	}

	const liveMs = await fetchLiveSince(streamerId);
	const perChannel = new Map();
	for (const row of rows) {
		const user = await bot.Users.get(row.User_Alias);
		if (user) {
			perChannel.set(row.Channel, [...(perChannel.get(row.Channel) ?? []), user.name]);
		}
	}

	for (const [channelId, users] of perChannel) {
		await sendTo(channelId, formatTitleChange(users, rows[0].Streamer_Login, title, game, liveMs));
	}
	console.log(`[notifications] Titelwechsel ${rows[0].Streamer_Login} -> ${rows.length} Abonnent(en) in ${perChannel.size} Channel(s)`);
};

/* ---------- ban ---------- */

const announceBan = async (channel, login, reason, customMessage) => {
	const base = `${login} has received a Twitch ban. Reason: ${reason}`;
	await channel.send(customMessage ? `${base} ${customMessage}` : base);
	console.log(`[notifications] Ban-Notify: ${login} in #${channel.name} (${reason})`);
};

/** Streamer-Login -> Twitch-User (fuer die Commands) */
const resolveStreamer = async (login) => await fetchTwitchUser(login).catch(() => null);

module.exports = {
	watchStreamer,
	watchTitle,
	subscribeAll,
	formatNotifyDuration,
	gamesPlayedText,
	formatStreamingPart,
	formatOfflineText,
	formatTitleChange,
	fetchLiveSince,
	announceStreamState,
	recordGameChange,
	announceTitleChange,
	announceBan,
	resolveStreamer,
};
