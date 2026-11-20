const { streamData } = require('../util/stream-tracking.js');
const { formatMonthlyBreakdown, parseMonthYear } = require('../misc/stream-hours.js');
const { fmtDate } = require('../misc/streamer-streak.js');

/**
 * Live-Stunden im laufenden Jahr, einem Monat ("january2026"), aller Zeit ("alltime"/"all"/"total") oder Monat fuer Monat
 * ("monthly [year]"), aus sb-v2 (ninou2, 08.-15.10.2026). Channel und Zusatzangaben reihenfolgeunabhaengig.
 * "soo far" nur fuer den laufenden Monat/das laufende Jahr. Alltime zeigt den ersten getrackten Stream und den
 * Durchschnitt pro Streaming-Tag - nur ueber das Tage-Tracking-Fenster, sonst verzerrt ein Stunden-Backfill ihn
 * (ninou2: 5444h / 13 Tage = 418h/Tag).
 */
module.exports = {
	name: 'hoursstreamed',
	aliases: ['hs'],
	cooldown: 3000,
	description:
		'Total hours streamed this year (or a given month, e.g. january2026, "alltime", or "monthly [year]" for a per-month breakdown) for a channel. Defaults to the current channel and year.',
	usage: 'hoursstreamed [channel] [month+year|alltime|monthly [year]]',
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const now = new Date();

		let channelRaw;
		let monthSpec = null;
		let allTime = false;
		let monthly = false;
		let explicitYear = null;
		for (const raw of args) {
			const low = raw.toLowerCase();
			if (low === 'alltime' || low === 'all' || low === 'total') {
				allTime = true;
			} else if (low === 'monthly') {
				monthly = true;
			} else if (parseMonthYear(raw)) {
				monthSpec = parseMonthYear(raw);
			} else if (/^\d{4}$/.test(raw)) {
				explicitYear = Number(raw);
			} else {
				channelRaw ??= raw;
			}
		}

		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		const where = own ? 'this channel' : `#${channel}`;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		if (monthly) {
			const year = explicitYear ?? now.getUTCFullYear();
			const rows = await streamData.getMonthlyBreakdown(userId, year);
			if (rows.length === 0) {
				return {
					text: `@${display}, no stream hours recorded for ${where} in ${year} — either tracking just started, or that's not a channel I watch.`,
				};
			}

			const totalHours = Math.round(rows.reduce((total, i) => total + i.seconds, 0) / 3600);
			return { text: `@${display}, in ${year} ${channel} streamed a total of ${totalHours}hours : ${formatMonthlyBreakdown(rows)}` };
		}

		const isCurrent = !allTime && (monthSpec ? monthSpec.year === now.getUTCFullYear() && monthSpec.month === now.getUTCMonth() + 1 : true);
		const periodLabel = monthSpec ? monthSpec.label : String(now.getUTCFullYear());
		const seconds = allTime
			? await streamData.getAllTimeSeconds(userId)
			: monthSpec
				? await streamData.getMonthSeconds(userId, monthSpec.year, monthSpec.month)
				: await streamData.getYearSeconds(userId, now.getUTCFullYear());

		if (!seconds) {
			return {
				text: `@${display}, no stream hours recorded for ${where}${allTime ? '' : ` in ${periodLabel}`} — either tracking just started, or that's not a channel I watch.`,
			};
		}

		const hours = Math.round(seconds / 3600);
		if (!allTime) {
			// ninou2, 08.10.2026: "in 2026, STREAMER has streamed XX soo far. alex it should be like this"
			return { text: `@${display}, in ${periodLabel}, ${channel} ${isCurrent ? 'has streamed' : 'streamed'} [${hours}h]${isCurrent ? ' soo far' : ''}.` };
		}

		// Kalendertage (inklusive heute) seit einem Tag
		const daysBetween = (fromDay) => {
			const from = new Date(`${fromDay}T00:00:00Z`).getTime();
			const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
			return Math.floor((today - from) / 86_400_000) + 1;
		};

		const firstSeen = await streamData.getFirstSeen(userId);
		const since = firstSeen ? ` (first on ${fmtDate(firstSeen)}, ${daysBetween(firstSeen)}d ago)` : '';

		const days = await streamData.getDays(userId);
		let average = '';
		if (days.length > 0) {
			const secondsSinceDays = await streamData.getSecondsSince(userId, days[0].slice(0, 7));
			const averageHours = secondsSinceDays / 3600 / days.length;
			const windowDays = daysBetween(days[0]);
			const perYear = Math.round((days.length / windowDays) * 365);
			// ninou2, 15.10.2026: "long message with words = bad"
			average = ` Avg [${averageHours.toFixed(1)}h]/day, [${days.length}/${windowDays}]d since ${fmtDate(days[0])} (~${perYear}/365/yr).`;
		}

		return { text: `@${display}, ${channel} has streamed [${hours}h] all-time${since}.${average}` };
	},
};
