const { streamData } = require('../util/stream-tracking.js');
const { MONTHS, parseMonthYear } = require('../util/stream-hours.js');
const { fmtDate } = require('../util/streamer-streak.js');
const { packLines, replyInChunks } = require('../util/tracking-format.js');

/**
 * Wie viele Tage ein Channel gestreamt hat, aus sb-v2 (ninou2, 15.10.2026: "monthly and yearly and total"). Ohne
 * Argument: laufendes Jahr. Jahreszahl, "october2026" (ninou2, 03.11.2026: "the command might be bugged" - der Monat
 * wurde still ignoriert), "monthly"/"monthly2026", "yearly", "total"/"alltime"/"all"; Channel optional
 * und reihenfolgeunabhaengig wie bei !hs. Datenbasis wie !streamerstreak (seit Tracking-Start, kein Backfill).
 */
const MESSAGE_LIMIT = 480;
const TOTAL_WORDS = new Set(['total', 'alltime', 'all']);

module.exports = {
	name: 'daysstreamed',
	aliases: ['ds'],
	cooldown: 3000,
	description:
		'How many days a channel has streamed. No argument = current year. Takes a year ("2026"), month+year ("october2026"), "monthly"/"monthly2026" for a month-by-month breakdown, "yearly" for every year with data, or "total"/"alltime"/"all". Defaults to the current channel.',
	usage: 'daysstreamed [channel] [year | month<year> | monthly[year] | yearly | total]',
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const now = new Date();

		let channelRaw;
		let monthSpec = null;
		let explicitYear = null;
		let monthly = false;
		let yearly = false;
		let total = false;
		for (const raw of args) {
			const low = raw.toLowerCase();
			const monthlyYear = low.match(/^monthly(\d{4})$/);
			if (low === 'monthly') {
				monthly = true;
			} else if (monthlyYear) {
				monthly = true;
				explicitYear = Number(monthlyYear[1]);
			} else if (low === 'yearly') {
				yearly = true;
			} else if (TOTAL_WORDS.has(low)) {
				total = true;
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

		const allDays = await streamData.getDays(userId);
		if (allDays.length === 0) {
			return { text: `@${display}, no streaming days recorded for ${where} yet — either tracking just started, or that's not a channel I watch.` };
		} else if (total) {
			return { text: `@${display}, ${channel} has streamed on [${allDays.length}] days all-time.` };
		}

		if (yearly) {
			const perYear = new Map();
			for (const day of allDays) {
				perYear.set(day.slice(0, 4), (perYear.get(day.slice(0, 4)) ?? 0) + 1);
			}

			const lines = [...perYear.keys()].sort().map((i) => `*${i}* —>[${perYear.get(i)}d]`);
			return await replyInChunks(msg, packLines(`@${display}, ${channel}'s streaming days by year: `, lines, MESSAGE_LIMIT, ' // ', false));
		}

		if (monthSpec) {
			const prefix = `${monthSpec.year}-${String(monthSpec.month).padStart(2, '0')}-`;
			const monthCount = allDays.filter((i) => i.startsWith(prefix)).length;
			if (!monthCount) {
				return {
					text: `@${display}, no streaming days recorded for ${where} in ${monthSpec.label} — either tracking just started, or that's not a channel I watch.`,
				};
			}

			const current = monthSpec.year === now.getUTCFullYear() && monthSpec.month === now.getUTCMonth() + 1;
			return { text: `@${display}, in ${monthSpec.label}, ${channel} streamed on [${monthCount}] days${current ? ' soo far' : ''}.` };
		}

		const year = explicitYear ?? now.getUTCFullYear();
		if (monthly) {
			const perMonth = new Map();
			for (const day of allDays) {
				if (day.startsWith(`${year}-`)) {
					const month = Number(day.slice(5, 7));
					perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
				}
			}
			if (perMonth.size === 0) {
				return {
					text: `@${display}, no streaming days recorded for ${where} in ${year} — either tracking just started, or that's not a channel I watch.`,
				};
			}

			const lines = [];
			for (let m = 1; m <= 12; m++) {
				const count = perMonth.get(m);
				if (count) {
					lines.push(`${MONTHS[m - 1]} -> [${count}d]`);
				}
			}

			return await replyInChunks(msg, packLines(`@${display}, ${channel}'s streaming days per month in ${year}: `, lines, MESSAGE_LIMIT, ' // ', false));
		}

		const count = allDays.filter((i) => i.startsWith(`${year}-`)).length;
		if (!count) {
			return { text: `@${display}, no streaming days recorded for ${where} in ${year} — either tracking just started, or that's not a channel I watch.` };
		}

		const soFar = year === now.getUTCFullYear() ? ' soo far' : '';
		// ninou2, 01.11.2026 (surferkillerhd: 560h, aber 12 Tage): Stunden sind nachgetragen, Tage erst ab Tracking-Start.
		// Gibt es im Jahr Stunden aus Monaten vor dem ersten getrackten Tag, ist die Zahl unvollstaendig -> dazusagen.
		const firstDay = allDays.find((i) => i.startsWith(`${year}-`));
		const hourMonths = await streamData.getMonthlyBreakdown(userId, year);
		const incomplete = hourMonths.some((i) => i.seconds > 0 && i.month < Number(firstDay.slice(5, 7)));
		const since = incomplete ? `, since day tracking started on ${fmtDate(firstDay)} (hours go back further)` : '';
		return { text: `@${display}, in ${year}, ${channel} streamed on [${count}] days${soFar}${since}.` };
	},
};
