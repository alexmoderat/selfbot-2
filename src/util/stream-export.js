const { formatCategoryDuration } = require('./category-hours.js');
const { formatPeriodLabel } = require('./stream-hours.js');
const { computeStreak, daysInYear, fmtDate, topStreaks, yearlyBreakdown } = require('./streamer-streak.js');

/**
 * Textdatei mit allen gespeicherten Stream-Daten eines Channels fuer !getdata (ninou2, 03.11.2026: "that any user
 * download a tracked user data", "so we [have] it as backup", "a TXT file with all info", "like longest streaming
 * streak"). Reine Formatierung ohne DB, die Daten holt der Command.
 */

const TOP_STREAKS = 10;
const hours = (seconds) => formatCategoryDuration(Math.round(seconds / 60));
const sumSeconds = (rows) => rows.reduce((total, i) => total + i.seconds, 0);
const section = (title, lines) => ['', title, '-'.repeat(title.length), ...lines];

const hasExportData = (data) => data.days.length > 0 || data.years.length > 0 || data.categoryAllTime.length > 0;

const formatStreamExport = (data) => {
	const { channel, generatedAt, days, years, months, categoryYears, categoryAllTime } = data;
	const totalSeconds = sumSeconds(years);
	const categorySeconds = sumSeconds(categoryAllTime);
	const streak = computeStreak(days, generatedAt.slice(0, 10));
	const yearHours = new Map(years.map((i) => [i.year, i.seconds]));

	const overview = [
		`Days streamed: ${new Set(days).size}`,
		`Hours streamed: ${hours(totalSeconds)}`,
		`Current streak: ${streak.current} days${streak.currentSince ? ` (since ${streak.currentSince})` : ''}`,
		`Longest streak: ${streak.longest} days${streak.longestStart ? ` (${streak.longestStart} to ${streak.longestEnd})` : ''}`,
		`Days cover: ${days.length > 0 ? `${[...days].sort()[0]} to ${[...days].sort().at(-1)}` : 'nothing yet'}`,
	];

	const perYear = yearlyBreakdown(days).map(
		(i) =>
			`${i.year}: ${i.count}/${daysInYear(i.year)} days, ${hours(yearHours.get(i.year) ?? 0)}, longest streak ${i.longestStreak} days (${i.longestStart} to ${i.longestEnd})`,
	);

	const daysByMonth = new Map();
	for (const day of [...new Set(days)].sort()) {
		const month = day.slice(0, 7);
		daysByMonth.set(month, [...(daysByMonth.get(month) ?? []), day.slice(8)]);
	}

	const lines = [
		`Stream data for ${channel}`,
		// ninou2, 03.11.2026: "at the start [of] the txt file it give the exact date when the data was generated"
		`Generated on ${generatedAt.slice(0, 10)} at ${generatedAt.slice(11, 19)} UTC, all dates in UTC.`,
		'Only what the bot has stored. Older data can be missing, especially for categories.',
	];

	lines.push(
		...section('OVERVIEW', overview),
		...section('BY YEAR', perYear),
		...section(
			`TOP ${TOP_STREAKS} STREAKS`,
			topStreaks(days, TOP_STREAKS).map((i, index) => `#${index + 1}: ${i.length} days (${i.start} to ${i.end})`),
		),
		...section(
			'HOURS BY MONTH',
			months.map((i) => `${i.year}-${String(i.month).padStart(2, '0')}: ${hours(i.seconds)}`),
		),
		...section(
			`CATEGORIES ALL-TIME (${hours(categorySeconds)} of ${hours(totalSeconds)} have a category)`,
			categoryAllTime.map(
				(i) =>
					// ninou2, 03.11.2026: "when the 1st time the game was played and when the last time", "if he cant give the exact day date , he can give onlly month and year"
					`${i.category}: ${hours(i.seconds)} (first: ${i.firstDay ? fmtDate(i.firstDay) : formatPeriodLabel(i.firstPeriod)}, last: ${i.lastDay ? fmtDate(i.lastDay) : formatPeriodLabel(i.lastPeriod)})`,
			),
		),
	);

	for (const { year, rows } of categoryYears) {
		lines.push(
			...section(
				`CATEGORIES ${year}`,
				rows.map((i) => `${i.category}: ${hours(i.seconds)}`),
			),
		);
	}

	lines.push(
		...section(
			'ALL STREAM DAYS',
			[...daysByMonth].map(([month, list]) => `${month} (${list.length}): ${list.join(' ')}`),
		),
	);
	return `${lines.join('\n')}\n`;
};

module.exports = { hasExportData, formatStreamExport };
