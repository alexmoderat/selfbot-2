const sbv2 = require('../database/sbv2.js');
const botList = require('./twitchinsights-bots.js');

// Datenschicht fuer das Tracking, aus sb-v2s watchtime-maria, peak-viewers-maria, raids-maria, watch-streak-maria,
// admin-settings-maria (stream_state) und longest-sub-maria. Rueckgaben in der alten Form (Spaltennamen), weil
// Commands und Module sie so lesen.

const pick = (modelName, doc, columns) => {
	if (!doc) {
		return null;
	}
	const row = bot.DB.toRow(modelName, doc);
	return Object.fromEntries(columns.map((column) => [column, row[column]]));
};

/* ---------- Bots (aus Ranglisten und Watchtime raus) ---------- */

const KNOWN_BOTS_TTL = 10 * 60 * 1000;
let knownBots = null;

/**
 * chat_data.known_bots pflegt der autojoin-bot (eigenes Repo), sb-v2 und dieser Bot lesen nur mit (SELECT-Recht),
 * dazu die TwitchInsights-Liste
 */
const isKnownBot = async (login) => {
	if (!knownBots || Date.now() - knownBots.at > KNOWN_BOTS_TTL) {
		const rows = await sbv2.query('SELECT login FROM chat_data.known_bots').catch(() => null);
		knownBots = { at: Date.now(), set: new Set((rows?.map((i) => i.login) ?? [...(knownBots?.set ?? [])]).map((i) => String(i).toLowerCase())) };
	}

	const name = login.toLowerCase();
	return knownBots.set.has(name) || botList.isListedBot(name);
};

/* ---------- Watchtime ---------- */

/** live = Minuten zaehlen als Watchtime, sonst als Offline-Chat-Zeit (ninou2, 17.09.2026: "2 differents stats") */
const addWatchtime = async (channel, users, minutes, live) => {
	if (users.length === 0) {
		return;
	}
	const now = new Date();
	await bot.DB.Watchtime.bulkWrite(
		users.map((i) => ({
			updateOne: {
				filter: { channel: channel.id, userId: i.id },
				update: { $inc: { [live ? 'minutes' : 'offlineMinutes']: Number(minutes) }, $set: { username: i.login, lastSeen: now } },
				upsert: true,
			},
		})),
		{ ordered: false },
	);
};

/** { Username, Minutes, Offline_Minutes } per Login oder User-ID */
const getWatchtime = async (channel, usernameOrId) =>
	pick('Watchtime', await bot.DB.Watchtime.findOne({ channel: channel.id, $or: [{ username: usernameOrId }, { userId: usernameOrId }] }).lean(), [
		'Username',
		'Minutes',
		'Offline_Minutes',
	]);

const getTopWatchtime = async (channel, offline, limit) => {
	const field = offline ? 'offlineMinutes' : 'minutes';
	const docs = await bot.DB.Watchtime.find({ channel: channel.id, [field]: { $gt: 0 } })
		.sort({ [field]: -1 })
		.limit(limit)
		.lean();
	return docs.map((doc) => pick('Watchtime', doc, ['Username', 'Minutes', 'Offline_Minutes']));
};

/** Meiste Nachrichten im Channel - aus messageMetaUserAlias, [{ Name, Count }] */
const getTopChatters = async (channel, limit) => {
	const docs = await bot.DB.MessageMetaUserAlias.find({ channel: channel.id }, { userAlias: 1, messageCount: 1 })
		.sort({ messageCount: -1 })
		.limit(limit)
		.lean();
	const users = await bot.DB.User.find({ _id: { $in: docs.map((i) => i.userAlias) } }, { name: 1 }).lean();
	const names = new Map(users.map((i) => [i._id, i.name]));
	return docs.filter((i) => names.has(i.userAlias)).map((i) => ({ Name: names.get(i.userAlias), Count: i.messageCount }));
};

/* ---------- Peak / Raids ---------- */

const recordPeakIfHigher = async (broadcasterId, channelName, year, viewers) => {
	const value = Number(viewers);
	const now = new Date();
	await bot.DB.PeakViewers.updateOne(
		{ userId: broadcasterId, year: Number(year) },
		[
			{
				$set: {
					channelName,
					seenAt: { $cond: [{ $gt: [value, { $ifNull: ['$viewers', -1] }] }, now, '$seenAt'] },
					viewers: { $max: [value, { $ifNull: ['$viewers', value] }] },
				},
			},
		],
		{ upsert: true },
	);
};

const getAllTimePeak = async (broadcasterId) =>
	pick('PeakViewers', await bot.DB.PeakViewers.findOne({ userId: broadcasterId }).sort({ viewers: -1 }).lean(), ['Channel_Name', 'Viewers', 'Seen_At']);

const recordRaid = async (channel, raiderLogin, raiderDisplay, viewerCount) => {
	await bot.DB.createWithId('RaidReceived', {
		channelId: channel.twitchId ?? '',
		channelName: channel.name,
		raiderLogin,
		raiderDisplay,
		viewerCount: Math.max(0, Math.trunc(viewerCount) || 0),
		seenAt: new Date(),
	});
};

const getRaidSummary = async (broadcasterId) => {
	const [biggest, count] = await Promise.all([
		bot.DB.RaidReceived.findOne({ channelId: broadcasterId }).sort({ viewerCount: -1, seenAt: 1 }).lean(),
		bot.DB.RaidReceived.countDocuments({ channelId: broadcasterId }),
	]);
	return biggest ? { ...pick('RaidReceived', biggest, ['Raider_Login', 'Viewer_Count', 'Seen_At']), count } : null;
};

/* ---------- Watch-Streaks ---------- */

/**
 * first* ist die erste Teilung des laufenden Streaks fuer !viewerstreakstart (ninou2, 03.11.2026). Faellt der Wert, hat
 * ein neuer Streak begonnen. Eintraege von vor dem Feld bleiben bis dahin null: sonst stuende dort "erste Teilung 175,
 * heute". Alle Ausdruecke einer $set-Stufe sehen den alten Stand (wie MariaDBs VALUES()).
 */
const buildWatchStreakUpdate = (entry, now = new Date()) => {
	const value = Math.trunc(entry.value);
	const isNew = { $eq: [{ $ifNull: ['$value', null] }, null] };
	const restarted = { $or: [isNew, { $lt: [value, '$value'] }] };
	const better = { $or: [{ $eq: [{ $ifNull: ['$bestValue', null] }, null] }, { $gt: [value, '$bestValue'] }] };
	return {
		filter: { channelId: entry.channelId, userId: entry.userId },
		update: [
			{
				$set: {
					firstSeenAt: { $cond: [restarted, now, '$firstSeenAt'] },
					firstValue: { $cond: [restarted, value, '$firstValue'] },
					bestSeenAt: { $cond: [better, now, '$bestSeenAt'] },
					bestValue: { $cond: [better, value, '$bestValue'] },
					channelName: entry.channel.toLowerCase(),
					login: entry.login.toLowerCase(),
					value,
					seenAt: now,
				},
			},
		],
	};
};

const recordWatchStreak = async (entry) => {
	const { filter, update } = buildWatchStreakUpdate(entry);
	await bot.DB.WatchStreak.updateOne(filter, update, { upsert: true });
};

const STREAK_COLUMNS = ['Login', 'Channel_Name', 'Value', 'Seen_At', 'Best_Value', 'Best_Seen_At', 'First_Value', 'First_Seen_At'];

const getWatchStreak = async (channelId, userId) => pick('WatchStreak', await bot.DB.WatchStreak.findOne({ channelId, userId }).lean(), STREAK_COLUMNS);

const getBestWatchStreak = async (userId) =>
	pick(
		'WatchStreak',
		await bot.DB.WatchStreak.findOne({ userId, bestValue: { $ne: null } })
			.sort({ bestValue: -1, bestSeenAt: 1 })
			.lean(),
		STREAK_COLUMNS.slice(0, 6),
	);

/** channelId null = ueber alle Channels */
const getTopWatchStreaks = async (channelId, limit) => {
	const docs = await bot.DB.WatchStreak.find({ bestValue: { $ne: null }, ...(channelId ? { channelId } : {}) })
		.sort({ bestValue: -1, bestSeenAt: 1 })
		.limit(Math.max(1, Math.min(500, Math.trunc(limit))))
		.lean();
	return docs.map((doc) => pick('WatchStreak', doc, STREAK_COLUMNS.slice(0, 6)));
};

/* ---------- Laengster Sub (chat_data.longest_sub, vom autojoin-bot gefuellt, nur lesen) ---------- */

const getLongestSub = async (userId) =>
	(await sbv2.query('SELECT user_id, username, channel, max_months FROM chat_data.longest_sub WHERE user_id = ? LIMIT 1', [userId]))[0] ?? null;

const getLongestSubRange = async (fromRank, toRank) =>
	await sbv2.query('SELECT user_id, username, channel, max_months FROM chat_data.longest_sub ORDER BY max_months DESC LIMIT ? OFFSET ?', [
		Math.max(0, toRank - fromRank + 1),
		Math.max(0, fromRank - 1),
	]);

/* ---------- Stream-Zustand (Start, Spiel, Kategoriewechsel) ---------- */

const setStreamState = async (channel, game) => {
	await bot.DB.StreamState.updateOne({ channel: channel.id }, { $set: { started: new Date(), game: game || null } }, { upsert: true });
	await bot.DB.StreamGameChange.deleteMany({ channel: channel.id });
};

const clearStreamState = async (channel) => {
	await bot.DB.StreamState.deleteOne({ channel: channel.id });
};

/** { Started, Game } oder null */
const getStreamState = async (channel) => pick('StreamState', await bot.DB.StreamState.findOne({ channel: channel.id }).lean(), ['Started', 'Game']);

const addStreamGameChange = async (channel, game) => {
	await bot.DB.createWithId('StreamGameChange', { channel: channel.id, game, changed: new Date() });
};

/** Aktuelle Kategorie: letzter Wechsel waehrend des Streams, sonst das Startspiel */
const getCurrentCategory = async (channel) => {
	const last = await bot.DB.StreamGameChange.findOne({ channel: channel.id }, { game: 1 }).sort({ changed: -1 }).lean();
	return last?.game ?? (await getStreamState(channel))?.Game ?? null;
};

/* ---------- Bot-Rekorde ---------- */

/** { Value, Achieved } oder null */
const getRecord = async (name) => pick('BotRecord', await bot.DB.BotRecord.findOne({ name }).lean(), ['Value', 'Achieved']);

/** true, wenn es ein neuer Rekord ist */
const updateRecordIfHigher = async (name, value) => {
	const current = await getRecord(name);
	if (current && current.Value >= value) {
		return false;
	}
	await bot.DB.BotRecord.updateOne({ name }, { $set: { value: Number(value), achieved: new Date() } }, { upsert: true });
	return true;
};

module.exports = {
	isKnownBot,
	addWatchtime,
	getWatchtime,
	getTopWatchtime,
	getTopChatters,
	recordPeakIfHigher,
	getAllTimePeak,
	recordRaid,
	getRaidSummary,
	buildWatchStreakUpdate,
	recordWatchStreak,
	getWatchStreak,
	getBestWatchStreak,
	getTopWatchStreaks,
	getLongestSub,
	getLongestSubRange,
	setStreamState,
	clearStreamState,
	getStreamState,
	addStreamGameChange,
	getCurrentCategory,
	getRecord,
	updateRecordIfHigher,
};
