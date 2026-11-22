const { streamData } = require('../util/stream-tracking.js');
const { computeStreak, countDaysInYear, daysInYear, fmtDate, tiesNote, topStreaks, yearlyBreakdown } = require('../util/streamer-streak.js');

/**
 * Aufeinanderfolgende Streaming-Tage, aus sb-v2. Ohne Zahl/Wort nur das laufende Jahr (mit "current Streak" und
 * "soo far"), eine Jahreszahl = genau dieses Jahr, "all" = laengster Streak aller Zeiten (ninou2, 17.10.2026: "!ss
 * 2024 , !ss all"), "top3" (top1-top10, bare "top" = 3) = die besten N Streaks, mit Jahr kombinierbar ("!ss top3 2026").
 * Fuehrendes "@" wird mitentfernt (ninou2, 29.09.2026: Twitch-Autocomplete). Zaehlung erst ab dem Cron, kein Import.
 */
const command = {
	name: 'streamerstreak',
	aliases: ['streak', 'ss'],
	cooldown: { user: 3 },
	access: { channel: 0 },
	description:
		'Current daily streaming streak for a channel, scoped to the current year by default. "<year>" for a specific year, "all" for the all-time longest streak, "top3" (1-10, optionally + a year) for the best N streaks. Defaults to the current channel.',
	usage: 'streamerstreak [channel] [year|all] [top1-10]',
	execute: async ({ client, message: msg }) => {
		const words = [...msg.args];
		const display = msg.displayName;

		let modeWord;
		let topCount;
		let channelArg;
		for (const word of words) {
			const lower = word.toLowerCase();
			const topMatch = /^top(\d{1,2})?$/.exec(lower);
			if (topCount === undefined && topMatch) {
				const n = topMatch[1] ? Number(topMatch[1]) : 3;
				if (n >= 1 && n <= 10) {
					topCount = n;
					continue;
				}
			}

			if (modeWord === undefined && (lower === 'all' || /^\d{4}$/.test(word))) {
				modeWord = lower;
			} else if (channelArg === undefined) {
				channelArg = word;
			}
		}

		const channel = (channelArg ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		// Per ID statt Name - findet auch nach einer Umbenennung die richtige Historie
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return `@${display}, no Twitch account named "${channel}" exists.`;
		}

		const days = await streamData.getDays(userId);
		if (days.length === 0) {
			return `@${display}, no stream days recorded yet for ${own ? 'this channel' : `#${channel}`} — either tracking just started, or that's not a channel I watch.`;
		}

		const now = new Date();
		const today = now.toISOString().slice(0, 10);
		const currentYear = now.getUTCFullYear();

		if (topCount !== undefined) {
			const yearScope = modeWord && modeWord !== 'all' ? Number(modeWord) : undefined;
			const scopedDays = yearScope ? days.filter((i) => i.startsWith(`${yearScope}-`)) : days;
			const runs = topStreaks(scopedDays, topCount);
			if (runs.length === 0) {
				return `@${display}, no stream days recorded for ${own ? 'this channel' : `#${channel}`} ${yearScope ? `in ${yearScope}` : ''}.`;
			}

			const list = runs.map((r, i) => `#${i + 1} ${r.length} (${fmtDate(r.start)} to ${fmtDate(r.end)})`).join(' , ');
			return `@${display}, ${channel}'s top ${runs.length} streaks ${yearScope ? `in ${yearScope}` : 'all time'}: ${list}`;
		}

		if (modeWord === 'all') {
			const { current, longest, longestStart, longestEnd, longestTies } = computeStreak(days, today);
			const endsToday = longestEnd === today ? ' "today"' : '';
			const reply =
				`${channel} stream is at ${current} Streak, their LONGEST streaming Streak was ${longest}, ` +
				`[Recoreded FROM ${fmtDate(longestStart)} TO ${fmtDate(longestEnd)}${endsToday}${tiesNote(longestTies)}] , ` +
				`in ${currentYear} they streamed : ${countDaysInYear(days, currentYear)}/${daysInYear(currentYear)} soo far`;
			return `@${display}, ${reply}`;
		}

		const targetYear = modeWord ? Number(modeWord) : currentYear;
		const yearStat = yearlyBreakdown(days).find((i) => i.year === targetYear);
		if (!yearStat) {
			return `@${display}, no stream days recorded for ${own ? 'this channel' : `#${channel}`} in ${targetYear}.`;
		}

		if (targetYear === currentYear) {
			const { current } = computeStreak(days, today);
			const endsToday = yearStat.longestEnd === today ? ' "today"' : '';
			const reply =
				`${channel} stream is at ${current} Streak, their LONGEST streaming Streak in ${targetYear} was ${yearStat.longestStreak}, ` +
				`[Recoreded FROM ${fmtDate(yearStat.longestStart)} TO ${fmtDate(yearStat.longestEnd)}${endsToday}${tiesNote(yearStat.longestTies)}] , ` +
				`in ${targetYear} they streamed : ${yearStat.count}/${yearStat.total} soo far`;
			return `@${display}, ${reply}`;
		}

		// Vergangenes Jahr: kein "current Streak"/"soo far" ("when its in the past, its already done")
		const reply =
			`${channel}'s ${targetYear} stream streak: their LONGEST streaming Streak was ${yearStat.longestStreak}, ` +
			`[Recoreded FROM ${fmtDate(yearStat.longestStart)} TO ${fmtDate(yearStat.longestEnd)}${tiesNote(yearStat.longestTies)}] , ` +
			`they streamed : ${yearStat.count}/${yearStat.total}`;
		return `@${display}, ${reply}`;
	},
};

module.exports = { command };
