const { categoryHoursReport } = require('../util/category-hours-report.js');
const { streamData } = require('../util/stream-tracking.js');
const { formatCategoryDuration, matchCategories } = require('../util/category-hours.js');
const { MONTHS, parseMonthYear, isPeriodWord } = require('../util/stream-hours.js');
const { packLines, replyInChunks } = require('../util/tracking-format.js');

/**
 * Stunden eines Channels in einer bestimmten Kategorie (ninou2, 01.11.2026: "!CheckHoursStreamedCategory !chsc",
 * "!chsc Darksiders Genesis" = gesamt, dazu "2026", "january2026", "as always : yearly / monthly"; "!chsc xqc ..." fuer
 * einen anderen Channel). Der Zeitraum steht hinten, ausser der ganze Text ist selbst ein Spielname ("FIFA 2026").
 * Das erste Wort gilt nur als Channel, wenn der aktuelle Channel keine passende Kategorie hat.
 */
const MESSAGE_LIMIT = 480;
const FIRST_TRACKABLE_YEAR = 2011;
const TOTAL_WORDS = new Set(['total', 'alltime', 'all']);

const parsePeriod = (word, now) => {
	const low = word.toLowerCase();
	const monthlyYear = low.match(/^monthly(\d{4})$/);
	const month = parseMonthYear(low);
	if (TOTAL_WORDS.has(low)) {
		return 'total';
	} else if (low === 'yearly') {
		return { kind: 'yearly' };
	} else if (low === 'monthly') {
		return { kind: 'monthly', year: now.getUTCFullYear() };
	} else if (monthlyYear) {
		return { kind: 'monthly', year: Number(monthlyYear[1]) };
	} else if (month) {
		return { kind: 'month', ...month };
	} else if (/^\d{4}$/.test(low) && Number(low) >= FIRST_TRACKABLE_YEAR && Number(low) <= now.getUTCFullYear()) {
		return { kind: 'year', year: Number(low) };
	}

	return null;
};

const sumMatching = (rows, names) => rows.reduce((sum, i) => (names.has(i.category) ? sum + i.seconds : sum), 0);
const duration = (seconds) => formatCategoryDuration(Math.round(seconds / 60));

module.exports = {
	name: 'checkhoursstreamedcategory',
	aliases: ['chsc'],
	cooldown: 3000,
	description:
		'How many hours a channel has streamed a specific category. No period = all-time. Add a year ("2026"), month+year ("january2026"), "yearly" or "monthly"/"monthly2026" at the end. An exact name wins, otherwise every category containing the text counts. Start with a channel name to check another channel.',
	usage: 'checkhoursstreamedcategory [channel] <category> [year | month<year> | yearly | monthly[year]]',
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const now = new Date();
		if (args.length === 0) {
			return { text: `@${display}, which category? Example: ${msg.prefix}chsc Just Chatting` };
		}

		const ownChannel = msg.channelData?.name ?? '';
		const ownId = ownChannel ? await streamData.fetchUserId(ownChannel) : null;
		const ownRows = ownId ? await streamData.getCategoryAllTimeBreakdown(ownId) : [];

		// "FIFA 2026" als exakter Spielname ist kein Zeitraum
		const fullText = args.join(' ').toLowerCase();
		const isExactName = ownRows.some((i) => i.category.toLowerCase() === fullText);
		const parsed = args.length > 1 && !isExactName ? parsePeriod(args[args.length - 1], now) : null;
		const words = parsed ? args.slice(0, -1) : args;
		const period = parsed === 'total' ? null : parsed;

		let query = words.join(' ');
		let channel = ownChannel;
		let userId = ownId;
		let rows = ownRows;
		if (matchCategories(ownRows, query).length === 0 && words.length > 1) {
			const candidate = words[0].replace(/^[@#]+/, '').toLowerCase();
			const candidateId = await streamData.fetchUserId(candidate);
			const candidateRows = candidateId ? await streamData.getCategoryAllTimeBreakdown(candidateId) : [];
			if (candidateRows.length > 0) {
				channel = candidate;
				userId = candidateId;
				rows = candidateRows;
				query = words.slice(1).join(' ');
			}
		}

		// Nur ein Channel ohne Kategorie ("!chsc im_row1 november2026"): alle Kategorien des Channels, wie !hsc
		if (words.length === 1 && matchCategories(rows, query).length === 0 && args.slice(1).every(isPeriodWord)) {
			const candidateId = await streamData.fetchUserId(words[0].replace(/^[@#]+/, '').toLowerCase());
			if (candidateId && (await streamData.getCategoryYears(candidateId)).length > 0) {
				return await categoryHoursReport(msg);
			}
		}

		const where = channel === ownChannel ? 'this channel' : `#${channel}`;
		const matches = matchCategories(rows, query);
		if (!userId || matches.length === 0) {
			return { text: `@${display}, no tracked hours in a category matching "${query}" for ${where}.` };
		}

		const names = new Set(matches.map((i) => i.category));
		const subject = matches.length === 1 ? `[${matches[0].category}]` : `[${matches.length} categories matching "${query}"]`;
		const packed = (head, lines) => replyInChunks(msg, packLines(head, lines, MESSAGE_LIMIT, ' // ', false));

		if (period?.kind === 'yearly') {
			const lines = [];
			for (const year of (await streamData.getCategoryYears(userId)).toSorted((a, b) => a - b)) {
				const seconds = sumMatching(await streamData.getCategoryYearBreakdown(userId, year), names);
				if (seconds >= 60) {
					lines.push(`*${year}* —>[${duration(seconds)}]`);
				}
			}

			return await packed(`@${display}, @${channel}'s hours in ${subject} by year: `, lines);
		}

		if (period?.kind === 'monthly') {
			const lines = [];
			for (let m = 1; m <= 12; m++) {
				const seconds = sumMatching(await streamData.getCategoryMonthBreakdown(userId, period.year, m), names);
				if (seconds >= 60) {
					lines.push(`${MONTHS[m - 1]} -> [${duration(seconds)}]`);
				}
			}

			if (lines.length === 0) {
				return { text: `@${display}, no tracked hours in ${subject} for ${where} in ${period.year}.` };
			}

			return await packed(`@${display}, @${channel}'s hours in ${subject} per month in ${period.year}: `, lines);
		}

		if (period) {
			const label = period.kind === 'month' ? period.label : String(period.year);
			const periodRows =
				period.kind === 'month'
					? await streamData.getCategoryMonthBreakdown(userId, period.year, period.month)
					: await streamData.getCategoryYearBreakdown(userId, period.year);

			const seconds = sumMatching(periodRows, names);
			if (seconds < 60) {
				return { text: `@${display}, no tracked hours in ${subject} for ${where} in ${label}.` };
			}

			return { text: `@${display}, in ${label}, @${channel} has streamed ${subject} for ${duration(seconds)}.` };
		}

		const years = await streamData.getCategoryYears(userId);
		const first = years[years.length - 1];
		const last = years[0];
		const range = first === last ? `(${first})` : `(${first}-${last})`;
		return { text: `@${display}, @${channel} has streamed ${subject} for ${duration(sumMatching(rows, names))} ALLTIME ${range}.` };
	},
};
