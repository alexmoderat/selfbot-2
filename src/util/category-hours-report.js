const { streamData } = require('./stream-tracking.js');
const { formatCategoryBreakdown, formatCategoryParts } = require('./category-hours.js');
const { MONTHS, parseMonthYear } = require('./stream-hours.js');
const { fmtDate } = require('./streamer-streak.js');
const { replyInChunks } = require('./tracking-format.js');

/**
 * Kategorie-Stunden eines Channels, frueher der Command !hsc (ninou2, 13.-23.10.2026). Der Command ist entfernt
 * (alexmoderat, 11.11.2026: kaum genutzt), !chsc nutzt die Ausgabe weiter fuer "nur Channel ohne Kategorie".
 * Ohne Argument: laufendes Jahr. Jahr, "july2026", "alltime"/"all"/"total" oder "monthly"/"monthly2026". Volle Liste ueber mehrere Nachrichten statt
 * abzuschneiden (ninou2, 23.10.2026: "ONLY CHANGE WHAT i TELL YOU"), am Ende "/// [Nh TOTAL]", Channel mit @ gepingt.
 */
const MESSAGE_LIMIT = 480;

const categoryHoursReport = async (msg) => {
	const args = [...msg.args];
	const display = msg.displayName;
	const now = new Date();

	let channelRaw;
	let monthSpec = null;
	let explicitYear = null;
	let monthly = false;
	let allTime = false;
	for (const raw of args) {
		const low = raw.toLowerCase();
		const monthlyYear = low.match(/^monthly(\d{4})$/);
		if (low === 'alltime' || low === 'all' || low === 'total') {
			allTime = true;
		} else if (low === 'monthly') {
			monthly = true;
		} else if (monthlyYear) {
			monthly = true;
			explicitYear = Number(monthlyYear[1]);
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

	const year = monthSpec?.year ?? explicitYear ?? now.getUTCFullYear();
	// ninou2, 15.10.2026: Tracking-Start nennen, wenn die Daten nicht am 1. Januar beginnen - tagesgenau, sonst monatsgenau
	const trackingNote = async (y) => {
		const firstSeen = await streamData.getCategoryFirstSeen(userId);
		if (firstSeen && Number(firstSeen.slice(0, 4)) === y) {
			return ` (tracking started on ${fmtDate(firstSeen)})`;
		}

		const earliest = await streamData.getCategoryEarliestPeriod(userId);
		if (!earliest) {
			return '';
		}

		const [eYear, eMonth] = earliest.split('-').map(Number);
		return eYear !== y || eMonth <= 1 ? '' : ` (tracking started in ${MONTHS[eMonth - 1]} ${eYear})`;
	};

	const toMinutes = (rows) => rows.map((i) => ({ category: i.category, minutes: Math.round(i.seconds / 60) }));

	if (monthly) {
		const lines = [];
		let totalSeconds = 0;
		for (let m = 1; m <= 12; m++) {
			const rows = await streamData.getCategoryMonthBreakdown(userId, year, m);
			totalSeconds += rows.reduce((total, i) => total + i.seconds, 0);
			const breakdown = formatCategoryBreakdown(toMinutes(rows));
			if (breakdown) {
				lines.push(`${MONTHS[m - 1]}: ${breakdown}`);
			}
		}

		if (lines.length === 0) {
			return { text: `@${display}, no tracked hours for ${where} in ${year} — either tracking just started, or that's not a channel I watch.` };
		}

		lines[lines.length - 1] += `${await trackingNote(year)} /// [${Math.round(totalSeconds / 3600)}h TOTAL]`;
		const head = `@${display}, @${channel}'s categories per month in ${year}: `;
		return await replyInChunks(msg, packCategoryLines(head, lines, ' // '));
	}

	const rows = allTime
		? await streamData.getCategoryAllTimeBreakdown(userId)
		: monthSpec
			? await streamData.getCategoryMonthBreakdown(userId, monthSpec.year, monthSpec.month)
			: await streamData.getCategoryYearBreakdown(userId, year);

	const label = allTime ? 'all-time' : monthSpec ? monthSpec.label : String(year);
	const parts = formatCategoryParts(toMinutes(rows));
	if (parts.length === 0) {
		return {
			text: `@${display}, no tracked hours for ${where}${allTime ? '' : ` in ${label}`} — either tracking just started, or that's not a channel I watch.`,
		};
	}

	// ninou2, 23.10.2026: "@ninou2 has streamed ALLTIME (2023-2026)" - erstes und letztes Jahr, bei nur einem Jahr nur das
	let allTimeRange = '';
	if (allTime) {
		const years = await streamData.getCategoryYears(userId);
		if (years.length > 0) {
			const first = years[years.length - 1];
			const last = years[0];
			allTimeRange = first === last ? ` (${first})` : ` (${first}-${last})`;
		}
	}

	const totalHours = Math.round(rows.reduce((total, i) => total + i.seconds, 0) / 3600);
	const note = `${monthSpec || allTime ? '' : await trackingNote(year)} /// [${totalHours}h TOTAL]`;
	const head = allTime ? `@${display}, @${channel} has streamed ALLTIME${allTimeRange}: ` : `@${display}, in ${label}, @${channel} has streamed: `;

	// Kategorien einzeln packen; der Hinweis haengt am letzten Stueck, wenn er dort noch passt
	const chunks = packCategoryLines(head, parts, ' ');
	const last = chunks.length - 1;
	if (chunks[last].length + note.length > MESSAGE_LIMIT) {
		chunks.push(note.trim());
	} else {
		chunks[last] += note;
	}

	return await replyInChunks(msg, chunks);
};

/** Wie sb-v2: Kopfzeile nur in der ersten Nachricht, keinen Eintrag zerreissen */
const packCategoryLines = (head, lines, separator) => {
	const chunks = [];
	let current = head;
	for (const line of lines) {
		const piece = (current === head ? '' : separator) + line;
		if (current.length + piece.length > MESSAGE_LIMIT) {
			chunks.push(current);
			current = line;
		} else {
			current += piece;
		}
	}

	chunks.push(current);
	return chunks;
};

module.exports = { categoryHoursReport, packCategoryLines };
