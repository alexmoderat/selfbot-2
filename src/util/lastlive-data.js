const { streamData } = require('./stream-tracking.js');
const { MIN_STREAM_SECONDS, countDaysInYear, daysAgoWithDate, daysInYear, fmtDate, fmtDateTimeUtc, fmtLengthShort, fmtStreamSpanUtc } = require('./streamer-streak.js');

/**
 * Wann ein Channel zuletzt live war (aus dem Command lastlive, ninou2, 02.10.2026: Alias "ll"), als Daten fuer die
 * Variablen {ll_*} der Custom Commands. Bevorzugt Start und Laenge des neuesten VODs (minutengenau), sonst die Startzeit des
 * Crons mit zuletzt-live als Ende, sonst nur das Datum; ohne Tracking und ohne VOD Twitchs lastBroadcast. Mehrere VODs am
 * selben Tag werden einzeln aufgelistet (ninou2, 14.10.2026: "went live twice today, but the bot only mentioned the last").
 * Gerade live: laufender Stream plus der Stream davor (ninou2, 03.11.2026), der vorherige aus den VODs, ohne VOD der letzte
 * Streamtag. Streamer mit @ genannt (ninou2, 10.11.2026). ll_kind: notfound | live | none | untracked | multi | single.
 */

/**
 * " [they streamed 286/365; 1500h soo far this year]": Streamtage und Gesamtstunden des Jahres (ninou2, 12.11.2026,
 * 13.11.2026: "this format please"). Stunden nur, wenn welche aufgezeichnet sind.
 */
const yearStreamedText = async (userId, days, year) => {
	const seconds = await streamData.getYearSeconds(userId, year).catch(() => null);
	const hours = seconds ? `; ${Math.round(seconds / 3600)}h` : '';
	return ` [they streamed ${countDaysInYear(days, year)}/${daysInYear(year)}${hours} soo far this year]`;
};

const describeLive = async (channel, userId, startedAt) => {
	const now = new Date();
	const startMs = Date.parse(startedAt);
	if (Number.isNaN(startMs)) {
		return { kind: 'live' };
	}

	const today = now.toISOString().slice(0, 10);
	const data = { kind: 'live', start: startedAt.slice(11, 16), length: fmtLengthShort(now.getTime() - startMs) };
	const [days, vods] = await Promise.all([streamData.getDays(userId), streamData.fetchRecentVods(channel, 5).catch(() => [])]);

	const year = Number(today.slice(0, 4));
	data.year = days.length > 0 ? await yearStreamedText(userId, days, year) : '';
	const previous = vods.find((i) => i.lengthSeconds >= MIN_STREAM_SECONDS && Date.parse(i.createdAt) < startMs - 10 * 60_000);
	if (previous) {
		const previousStart = new Date(previous.createdAt).toISOString();
		const previousEnd = new Date(Date.parse(previous.createdAt) + previous.lengthSeconds * 1000).toISOString();
		data.prev = `, Last live before this current stream was on ${fmtStreamSpanUtc(previousStart, previousEnd)} (${daysAgoWithDate(previousStart.slice(0, 10), today)})`;
		return data;
	}

	const startDay = new Date(startMs).toISOString().slice(0, 10);
	const previousDay = days.filter((i) => i < startDay).at(-1);
	data.prev = previousDay ? `, Last live before this current stream was on ${fmtDate(previousDay)} (${daysAgoWithDate(previousDay, today)})` : '';
	return data;
};

/** channel = Login des Ziels, current = Login des Channels, in dem der Command laeuft */
const getLastLive = async (channel, current = '') => {
	const own = channel === current;
	const base = { channel, own: own ? 'this channel' : `#${channel}` };
	const userId = await streamData.fetchUserId(channel);
	if (!userId) {
		return { ...base, kind: 'notfound' };
	}

	const live = await streamData.fetchLiveStreams([userId]);
	const currentStream = live.get(userId);
	if (currentStream) {
		return { ...base, ...(await describeLive(channel, userId, currentStream.startedAt)) };
	}

	const days = await streamData.getDays(userId);
	const tracked = days.length > 0;
	// ninou2, 30.10.2026: "when using !ll it should not count it" - VODs unter 5 Minuten sind kein Stream
	const vods = (await streamData.fetchRecentVods(channel, 5).catch(() => [])).filter((i) => i.lengthSeconds >= MIN_STREAM_SECONDS);
	const vod = vods.at(0);

	if (!tracked && !vod) {
		const startedAt = await streamData.fetchLastBroadcastStart(channel).catch(() => null);
		if (!startedAt) {
			return { ...base, kind: 'none' };
		}

		const iso = new Date(startedAt).toISOString();
		return { ...base, kind: 'untracked', when: fmtDateTimeUtc(iso), ago: daysAgoWithDate(iso.slice(0, 10), new Date().toISOString().slice(0, 10)) };
	}

	const last = tracked ? days[days.length - 1] : vod.createdAt.slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	const stored = tracked ? await streamData.getLastStream(userId) : null;

	let start = null;
	let end = null;
	const vodStartMs = vod ? Date.parse(vod.createdAt) : Number.NaN;
	const storedStartMs = stored ? Date.parse(stored.start) : Number.NaN;
	// Ueber Mitternacht UTC laufende Streams: auch das ENDE gegen den letzten Tag pruefen (alexmoderat, 12.10.2026)
	const vodEndDay = vod ? new Date(vodStartMs + vod.lengthSeconds * 1000).toISOString().slice(0, 10) : null;
	const storedEndDay = stored?.seen ? stored.seen.slice(0, 10) : null;
	const vodMatches =
		Boolean(vod) &&
		(vod.createdAt.slice(0, 10) >= last || (vodEndDay !== null && vodEndDay >= last)) &&
		(!stored || Math.abs(vodStartMs - storedStartMs) < 10 * 60_000 || vodStartMs > storedStartMs);

	if (vod && vodMatches) {
		start = new Date(vodStartMs).toISOString();
		end = new Date(vodStartMs + vod.lengthSeconds * 1000).toISOString();
	} else if (stored && (stored.start.slice(0, 10) >= last || (storedEndDay !== null && storedEndDay >= last))) {
		start = stored.start;
		end = stored.seen && stored.seen > stored.start ? stored.seen : null;
	}

	const when = start ? (end ? fmtStreamSpanUtc(start, end) : fmtDateTimeUtc(start)) : fmtDate(last);
	const day = start ? start.slice(0, 10) : last;
	// ninou2, 03.10.2026: "add how many days they streamed this year to !ll" (nur getrackte Channels)
	const year = Number(today.slice(0, 4));
	const streamed = tracked ? await yearStreamedText(userId, days, year) : '';

	const todaysVods = vodMatches ? vods.filter((i) => i.createdAt.slice(0, 10) === day) : [];
	if (todaysVods.length > 1) {
		// ninou2, 16.10.2026: Tagesabstand statt hart "(today)"
		const dayLabel = daysAgoWithDate(day, today);
		const sessions = [...todaysVods]
			.reverse()
			.map((v, i) => {
				const full = fmtStreamSpanUtc(v.createdAt, new Date(Date.parse(v.createdAt) + v.lengthSeconds * 1000).toISOString());
				return `"stream #${i + 1}" ${full.slice(full.indexOf('['))} (${dayLabel})`;
			})
			.join(' , ');
		const totalMs = todaysVods.reduce((total, i) => total + i.lengthSeconds * 1000, 0);
		return {
			...base,
			kind: 'multi',
			date: fmtDate(day),
			count: String(todaysVods.length),
			sessions,
			total: fmtLengthShort(totalMs),
			dayword: day >= today ? 'today' : 'that day',
			year: streamed,
		};
	}

	return { ...base, kind: 'single', when, ago: daysAgoWithDate(day, today), year: streamed };
};

/** Vorlage wie die alte Antwort von !ll (als Standard fuer Website und zum Anlegen des Custom Commands) */
const DEFAULT_TEMPLATE =
	'{user}, {if ll_kind=notfound}no Twitch account named "{ll_channel}" exists.{/if}' +
	'{if ll_kind=live}@{ll_channel} is live right now{if ll_start} [{ll_start} UTC to now, ⏱{ll_length}]{ll_prev}{ll_year}{else}.{/if}{/if}' +
	'{if ll_kind=none}no stream found for {ll_own} (no VODs, never streamed as far as Twitch knows, and it is not tracked).{/if}' +
	'{if ll_kind=untracked}@{ll_channel} went live last time on {ll_when} ({ll_ago}){/if}' +
	'{if ll_kind=multi}@{ll_channel} went live last time on {ll_date} for "{ll_count}" times : {ll_sessions} , THEY streamed for a total of {ll_total} {ll_dayword}.{ll_year}{/if}' +
	'{if ll_kind=single}@{ll_channel} went live last time on {ll_when} ({ll_ago}){ll_year}{/if}';

module.exports = { getLastLive, DEFAULT_TEMPLATE };
