const { got } = require('../token/got.js');

const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { uploadList } = require('../misc/haste.js');
const { getLastBroadcastStart, getRecentVods, getVodGameMoments } = require('../misc/twitch-gql.js');

// Datenschicht der Stream-Statistiken, aus sb-v2s streamer-streak-maria, stream-hours-maria und
// streak-extra-channels-maria. Schluessel ist ueberall die User-ID, nicht der Login (alexmoderat, 29.09.2026: "if a user
// change his @, will the bot detect the new @"); channelName ist nur der zuletzt bekannte Anzeigename.
// Tage/Perioden als Text in JS berechnet (UTC), damit keine Zeitzone sie verschiebt.
// Alles haengt an einem Objekt, damit Tests einzelne Methoden ersetzen koennen (in sb-v2 ueber require.cache).

const period = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
const clean = (channel) => channel.replace('#', '').toLowerCase();
const today = (now = new Date()) => now.toISOString().slice(0, 10);
/** Anfang eines Texts als Regex (wie LIKE 'praefix%') */
const startsWith = (prefix) => new RegExp(`^${prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
/** Datum (MariaDB DATE) als 'YYYY-MM-DD' wie DATE_FORMAT(..., '%Y-%m-%d') */
const dayString = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

const sumSeconds = async (match) => {
	const [row] = await bot.DB.StreamHoursMonth.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$seconds' } } }]);
	return Number(row?.total ?? 0);
};

const streamData = {
	/* ---------- Twitch ---------- */

	async fetchUserId(login) {
		return (await fetchTwitchUser(login).catch(() => null))?.id ?? null;
	},

	/** Laufende Streams: User-ID -> Startzeit (ISO) und Kategorie, je 100 IDs ein Helix-Aufruf */
	async fetchLiveStreams(ids) {
		const result = new Map();
		for (let i = 0; i < ids.length; i += 100) {
			const response = await got('Helix')({
				url: 'streams',
				searchParams: new URLSearchParams([...ids.slice(i, i + 100).map((id) => ['user_id', id]), ['first', '100']]),
			}).catch(() => null);

			for (const stream of response?.body.data ?? []) {
				result.set(stream.user_id, { startedAt: stream.started_at, game: stream.game_name || null });
			}
		}
		return result;
	},

	async fetchRecentVods(login, limit) {
		return await getRecentVods(login, limit);
	},

	async fetchVodMoments(videoId) {
		return await getVodGameMoments(videoId);
	},

	async fetchLastBroadcastStart(login) {
		return await getLastBroadcastStart(login);
	},

	async uploadList(title, items) {
		return await uploadList(title, items);
	},

	/* ---------- Streaming-Tage / letzter Stream ---------- */

	async recordLiveToday(userId, channel, day = today()) {
		await bot.DB.StreamStreakDay.updateOne({ userId, day }, { $set: { channelName: clean(channel) } }, { upsert: true });
	},

	/** Alle Streaming-Tage aufsteigend ('YYYY-MM-DD') */
	async getDays(userId) {
		return (await bot.DB.StreamStreakDay.find({ userId }, { day: 1 }).sort({ day: 1 }).lean()).map((i) => i.day);
	},

	/** Startzeit des laufenden Streams; ein neuerer Start ueberschreibt, lastSeen wird immer nachgezogen */
	async recordStreamStart(userId, channel, startedAtIso) {
		// ISO-Texte sind lexikografisch vergleichbar (wie in MariaDB als VARCHAR)
		await bot.DB.StreamLastStart.updateOne(
			{ userId },
			[
				{
					$set: {
						channelName: clean(channel),
						lastSeen: new Date().toISOString(),
						startedAt: { $cond: [{ $gte: [startedAtIso, { $ifNull: ['$startedAt', ''] }] }, startedAtIso, '$startedAt'] },
					},
				},
			],
			{ upsert: true },
		);
	},

	/** Einzelne Streams, getrennt von den Streamtagen (ninou2, 03.11.2026: "make [sure] that this data [does] not get confused") */
	async logStream(userId, channel, startedAtIso) {
		await bot.DB.StreamLog.updateOne({ userId, startedAt: startedAtIso }, { $setOnInsert: { channelName: clean(channel) } }, { upsert: true });
	},

	/** prefix: "2026", "2026-11" oder leer fuer alle; first = aeltester Eintrag des Channels ueberhaupt */
	async countStreams(userId, prefix) {
		const [count, first] = await Promise.all([
			bot.DB.StreamLog.countDocuments({ userId, ...(prefix ? { startedAt: startsWith(prefix) } : {}) }),
			bot.DB.StreamLog.findOne({ userId }, { startedAt: 1 }).sort({ startedAt: 1 }).lean(),
		]);
		return { count, first: first?.startedAt ?? null };
	},

	async getLastStream(userId) {
		const row = await bot.DB.StreamLastStart.findOne({ userId }).lean();
		return row ? { start: row.startedAt, seen: row.lastSeen ?? null } : null;
	},

	/* ---------- Extra-Channels (!streaktrack) ---------- */

	/** existed = war schon eingetragen; Upsert statt SELECT-dann-INSERT (race-sicher, sb-v2 11.10.2026) */
	async addExtraChannel(userId, channel, addedBy) {
		const result = await bot.DB.StreakExtraChannel.updateOne(
			{ userId },
			{ $setOnInsert: { channelName: clean(channel), addedBy, added: new Date() } },
			{ upsert: true },
		);
		const row = await bot.DB.StreakExtraChannel.findOne({ userId }, { added: 1 }).lean();
		return { existed: result.upsertedCount === 0, addedAt: new Date(row?.added ?? Date.now()).toISOString() };
	},

	/** Per ID (ueberlebt Umbenennung) oder zuletzt bekanntem Namen (geloeschte Accounts) */
	async removeExtraChannel(userId, channel) {
		const conditions = [{ channelName: clean(channel) }];
		if (userId) {
			conditions.push({ userId });
		}
		return (await bot.DB.StreakExtraChannel.deleteMany({ $or: conditions })).deletedCount > 0;
	},

	async listExtraChannels() {
		const rows = await bot.DB.StreakExtraChannel.find({}).sort({ channelName: 1 }).lean();
		return rows.map((i) => ({ userId: i.userId, channel: i.channelName, addedBy: i.addedBy, addedAt: new Date(i.added).toISOString() }));
	},

	/* ---------- Stunden ---------- */

	/** Sekunden zum laufenden Monat (UTC) addieren, dazu einmalig den tagesgenauen Tracking-Start */
	async addSeconds(userId, channel, seconds) {
		const now = new Date();
		const p = period(now.getUTCFullYear(), now.getUTCMonth() + 1);
		await bot.DB.StreamHoursMonth.updateOne(
			{ userId, period: p },
			{ $set: { channelName: clean(channel) }, $inc: { seconds: Number(seconds) } },
			{ upsert: true },
		);
		await bot.DB.StreamHoursFirstSeen.updateOne({ userId }, { $setOnInsert: { channelName: clean(channel), firstSeen: today(now) } }, { upsert: true });
	},

	async getFirstSeen(userId) {
		return (await bot.DB.StreamHoursFirstSeen.findOne({ userId }, { firstSeen: 1 }).lean())?.firstSeen ?? null;
	},

	async getYearSeconds(userId, year) {
		const total = await sumSeconds({ userId, period: startsWith(`${Number(year)}-`) });
		return total > 0 ? total : null;
	},

	/** Sekunden ab einem Monat (inklusive) bis heute - fuer den Durchschnitt ueber das Tage-Tracking-Fenster */
	async getSecondsSince(userId, sincePeriod) {
		return await sumSeconds({ userId, period: { $gte: sincePeriod } });
	},

	async getMonthSeconds(userId, year, month) {
		const row = await bot.DB.StreamHoursMonth.findOne({ userId, period: period(year, month) }, { seconds: 1 }).lean();
		return row ? Number(row.seconds) : null;
	},

	async getAllTimeSeconds(userId) {
		const total = await sumSeconds({ userId });
		return total > 0 ? total : null;
	},

	async getAllYears(userId) {
		const rows = await bot.DB.StreamHoursMonth.aggregate([
			{ $match: { userId } },
			{ $group: { _id: { $substrBytes: ['$period', 0, 4] }, total: { $sum: '$seconds' } } },
			{ $sort: { _id: 1 } },
		]);
		return rows.map((i) => ({ year: Number(i._id), seconds: Number(i.total) }));
	},

	async getMonthlyBreakdown(userId, year) {
		const rows = await bot.DB.StreamHoursMonth.find({ userId, period: startsWith(`${year}-`) }, { period: 1, seconds: 1 })
			.sort({ period: 1 })
			.lean();
		return rows.map((i) => ({ month: Number(i.period.split('-')[1]), seconds: Number(i.seconds) }));
	},

	/** Jeder Channel mit Stunden-Daten (zuletzt bekannter Name), alphabetisch - fuer !streamertrack */
	async getTrackedChannels() {
		const rows = await bot.DB.StreamHoursMonth.aggregate([{ $group: { _id: '$userId', channel: { $min: '$channelName' } } }]);
		return rows.map((i) => i.channel).sort((a, b) => a.localeCompare(b));
	},

	/* ---------- Stunden nach Kategorie ---------- */

	async addCategorySeconds(userId, channel, category, seconds) {
		const now = new Date();
		const p = period(now.getUTCFullYear(), now.getUTCMonth() + 1);
		const day = new Date(`${today(now)}T00:00:00.000Z`);
		await bot.DB.CategoryHoursMonth.updateOne(
			{ userId, period: p, category },
			{ $set: { channelName: clean(channel) }, $inc: { seconds: Number(seconds) } },
			{ upsert: true },
		);
		await bot.DB.CategoryHoursFirstSeen.updateOne({ userId }, { $setOnInsert: { channelName: clean(channel), firstSeen: today(now) } }, { upsert: true });
		// ninou2, 03.11.2026: "know the exact date day 1st playing a category and when last played" - neue Kategorien
		// bekommen beide Tage; bestehende haben schon einen Eintrag mit firstDay null, dort wird nur lastDay exakt
		await bot.DB.CategoryDayRange.updateOne({ userId, category }, { $set: { lastDay: day }, $setOnInsert: { firstDay: day } }, { upsert: true });
	},

	async getCategoryFirstSeen(userId) {
		return (await bot.DB.CategoryHoursFirstSeen.findOne({ userId }, { firstSeen: 1 }).lean())?.firstSeen ?? null;
	},

	async getCategoryYearBreakdown(userId, year) {
		const rows = await bot.DB.CategoryHoursMonth.aggregate([
			{ $match: { userId, period: startsWith(`${Number(year)}-`) } },
			{ $group: { _id: '$category', total: { $sum: '$seconds' } } },
			{ $sort: { total: -1 } },
		]);
		return rows.map((i) => ({ category: i._id, seconds: Number(i.total) }));
	},

	async getCategoryMonthBreakdown(userId, year, month) {
		const rows = await bot.DB.CategoryHoursMonth.find({ userId, period: period(year, month) }, { category: 1, seconds: 1 })
			.sort({ seconds: -1 })
			.lean();
		return rows.map((i) => ({ category: i.category, seconds: Number(i.seconds) }));
	},

	async getCategoryAllTimeBreakdown(userId) {
		const [rows, ranges] = await Promise.all([
			bot.DB.CategoryHoursMonth.aggregate([
				{ $match: { userId } },
				{ $group: { _id: '$category', total: { $sum: '$seconds' }, firstPeriod: { $min: '$period' }, lastPeriod: { $max: '$period' } } },
				{ $sort: { total: -1 } },
			]),
			bot.DB.CategoryDayRange.find({ userId }).lean(),
		]);
		const byCategory = new Map(ranges.map((i) => [i.category, i]));
		return rows.map((i) => ({
			category: i._id,
			seconds: Number(i.total),
			firstPeriod: i.firstPeriod,
			lastPeriod: i.lastPeriod,
			firstDay: dayString(byCategory.get(i._id)?.firstDay),
			lastDay: dayString(byCategory.get(i._id)?.lastDay),
		}));
	},

	/** Jahre mit Kategorie-Daten, neueste zuerst */
	async getCategoryYears(userId) {
		const rows = await bot.DB.CategoryHoursMonth.aggregate([
			{ $match: { userId } },
			{ $group: { _id: { $substrBytes: ['$period', 0, 4] } } },
			{ $sort: { _id: -1 } },
		]);
		return rows.map((i) => Number(i._id));
	},

	/** Fruehester Kategorie-Monat - kann per Backfill vor dem tagesgenauen Tracking-Start liegen */
	async getCategoryEarliestPeriod(userId) {
		return (await bot.DB.CategoryHoursMonth.findOne({ userId }, { period: 1 }).sort({ period: 1 }).lean())?.period ?? null;
	},
};

module.exports = { streamData };
