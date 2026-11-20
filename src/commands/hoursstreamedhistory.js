const { streamData } = require('../util/stream-tracking.js');
const { formatMonthlyBreakdown } = require('../misc/stream-hours.js');
const { fmtDate } = require('../misc/streamer-streak.js');

/**
 * Live-Stunden pro Jahr fuer jedes Jahr mit Daten, oder mit "2026monthly"/nackter Jahreszahl Monat fuer Monat, aus sb-v2
 * (ninou2, 08.10.2026, Layout "*2026* —>[2h] // ..."). Tracking-Start tagesgenau (Stream_Hours_First_Seen), beim
 * Monats-Breakdown nur, wenn das Tracking in genau diesem Jahr begann.
 */
module.exports = {
	name: 'hoursstreamedhistory',
	aliases: ['hourshistory', 'hsh'],
	cooldown: 3000,
	description:
		'Yearly total hours streamed for a channel, for every year with recorded data — or, with YYYYmonthly (e.g. 2026monthly), a per-month breakdown of that year. Defaults to the current channel.',
	usage: 'hoursstreamedhistory [channel] [year|YYYYmonthly]',
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		let yearRaw;
		let channelRaw;
		for (const arg of args) {
			const monthly = arg.match(/^(\d{4})monthly$/i);
			if (monthly) {
				yearRaw = monthly[1];
			} else if (/^\d{4}$/.test(arg)) {
				yearRaw = arg;
			} else {
				channelRaw ??= arg;
			}
		}

		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		const where = own ? 'this channel' : `#${channel}`;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const firstSeen = await streamData.getFirstSeen(userId);
		if (yearRaw) {
			const year = Number(yearRaw);
			const rows = await streamData.getMonthlyBreakdown(userId, year);
			if (rows.length === 0) {
				return {
					text: `@${display}, no stream hours recorded for ${where} in ${year} — either tracking just started, or that's not a channel I watch.`,
				};
			}

			const trackingStart = firstSeen && Number(firstSeen.slice(0, 4)) === year ? ` (tracking started on ${fmtDate(firstSeen)})` : '';
			return { text: `@${display}, ${channel}'s Monthly Streaming Hours of the YEAR ${year} : ${formatMonthlyBreakdown(rows)}${trackingStart}` };
		}

		const years = await streamData.getAllYears(userId);
		if (years.length === 0) {
			return { text: `@${display}, no stream hours recorded yet for ${where} — either tracking just started, or that's not a channel I watch.` };
		}

		const list = years
			.map(({ year, seconds }, i) => {
				const note = i === 0 && firstSeen ? ` (tracking started on ${fmtDate(firstSeen)})` : '';
				return `*${year}* —>[${Math.round(seconds / 3600)}h]${note}`;
			})
			.join(' // ');

		// ninou2, 08.10.2026: "better use the word streaming instead of stream"
		return { text: `@${display}, ${channel}'s yearly streaming hours history : ${list}` };
	},
};
