const { streamData } = require('../util/stream-tracking.js');
const {
	MIN_STREAM_SECONDS,
	countDaysInYear,
	daysAgoWithDate,
	daysInYear,
	fmtDate,
	fmtDateTimeUtc,
	fmtLengthShort,
	fmtStreamSpanUtc,
} = require('../util/streamer-streak.js');

/**
 * Wann ein Channel zuletzt live war, aus sb-v2 (ninou2, 02.10.2026, Alias "ll" - lastline hat dafuer "llog").
 * Bevorzugt Start und Laenge des neuesten VODs (minutengenau), sonst die Startzeit des Crons mit zuletzt-live als Ende,
 * sonst nur das Datum; ohne Tracking und ohne VOD Twitchs lastBroadcast. Mehrere VODs am selben Tag werden einzeln
 * aufgelistet (ninou2, 14.10.2026: "went live twice today, but the bot only mentioned the last").
 * Streamer mit @ genannt (ninou2, 10.11.2026: "make it @ the streamer").
 */
/**
 * Gerade live: laufender Stream plus der Stream davor (ninou2, 03.11.2026: "xqc [is live] right now [15:00 UTC to ...],
 * Last [live] before this Current stream was on november 2nd 2026 [...]"). Der gespeicherte Start wird vom laufenden Stream
 * ueberschrieben, deshalb kommt der vorherige aus den VODs, ohne VOD bleibt nur der letzte Streamtag.
 */
/**
 * "[they streamed 286/365; 1500h soo far this year]": Streamtage und Gesamtstunden des Jahres (ninou2, 12.11.2026:
 * "total hours streamed this year"; 13.11.2026: "this format please : [they streamed 159/365; 581h soo far this year]").
 * Stunden nur, wenn welche aufgezeichnet sind.
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
		return `@${channel} is live right now.`;
	}

	const today = now.toISOString().slice(0, 10);
	const head = `@${channel} is live right now [${startedAt.slice(11, 16)} UTC to now, ⏱${fmtLengthShort(now.getTime() - startMs)}]`;
	const [days, vods] = await Promise.all([streamData.getDays(userId), streamData.fetchRecentVods(channel, 5).catch(() => [])]);

	const year = Number(today.slice(0, 4));
	const streamed = days.length > 0 ? await yearStreamedText(userId, days, year) : '';
	const previous = vods.find((i) => i.lengthSeconds >= MIN_STREAM_SECONDS && Date.parse(i.createdAt) < startMs - 10 * 60_000);
	if (previous) {
		const previousStart = new Date(previous.createdAt).toISOString();
		const previousEnd = new Date(Date.parse(previous.createdAt) + previous.lengthSeconds * 1000).toISOString();
		return `${head}, Last live before this current stream was on ${fmtStreamSpanUtc(previousStart, previousEnd)} (${daysAgoWithDate(previousStart.slice(0, 10), today)})${streamed}`;
	}

	const startDay = new Date(startMs).toISOString().slice(0, 10);
	const previousDay = days.filter((i) => i < startDay).at(-1);
	return previousDay
		? `${head}, Last live before this current stream was on ${fmtDate(previousDay)} (${daysAgoWithDate(previousDay, today)})${streamed}`
		: `${head}${streamed}`;
};

module.exports = {
	name: 'lastlive',
	aliases: ['ll'],
	cooldown: 3000,
	description:
		'When a channel last went live (start, end and length from the latest VOD or the recorded streaming days). The yearly stream count is shown for channels tracked via streaktrack. Defaults to the current channel.',
	usage: 'lastlive [channel]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const channel = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const live = await streamData.fetchLiveStreams([userId]);
		const current = live.get(userId);
		if (current) {
			return { text: `@${display}, ${await describeLive(channel, userId, current.startedAt)}` };
		}

		const days = await streamData.getDays(userId);
		const tracked = days.length > 0;
		// ninou2, 30.10.2026: "when using !ll it should not count it" - VODs unter 5 Minuten sind kein Stream
		const vods = (await streamData.fetchRecentVods(channel, 5).catch(() => [])).filter((i) => i.lengthSeconds >= MIN_STREAM_SECONDS);
		const vod = vods.at(0);

		if (!tracked && !vod) {
			const startedAt = await streamData.fetchLastBroadcastStart(channel).catch(() => null);
			if (!startedAt) {
				return {
					text: `@${display}, no stream found for ${own ? 'this channel' : `#${channel}`} (no VODs, never streamed as far as Twitch knows, and it is not tracked).`,
				};
			}

			const iso = new Date(startedAt).toISOString();
			return {
				text: `@${display}, @${channel} went live last time on ${fmtDateTimeUtc(iso)} (${daysAgoWithDate(iso.slice(0, 10), new Date().toISOString().slice(0, 10))})`,
			};
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
				text: `@${display}, @${channel} went live last time on ${fmtDate(day)} for "${todaysVods.length}" times : ${sessions} , THEY streamed for a total of ${fmtLengthShort(totalMs)} ${day >= today ? 'today' : 'that day'}.${streamed}`,
			};
		}

		return { text: `@${display}, @${channel} went live last time on ${when} (${daysAgoWithDate(day, today)})${streamed}` };
	},
};
