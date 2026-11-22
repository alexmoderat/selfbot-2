const { withTrigger } = require('./trigger-suffix.js');
const { fmtDate } = require('./streamer-streak.js');
// Format-Helfer fuer Watchtime, Watch-Streaks und Ranglisten, aus sb-v2s src/services/watchtime.js (formatMinutes),
// v2/utils/watch-streak.ts und v2/utils/topclips.ts (packLines). Reine Funktionen.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const ordinal = (n) => {
	const mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 13) {
		return `${n}th`;
	}

	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
};

const toDate = (input) => new Date(typeof input === 'string' ? input : Number(input.valueOf()));

/** "6th october 2026" */
const formatSharedDate = (input) => {
	const d = toDate(input);
	return Number.isNaN(d.getTime()) ? 'unknown date' : `${ordinal(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** "oct 6 2026" */
const formatShortDate = (input) => {
	const d = toDate(input);
	return Number.isNaN(d.getTime()) ? 'unknown date' : `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
};

/** Erste n Zeilen, dazu alle mit demselben Wert wie die n-te (Gleichstand nicht abschneiden) */
const takeWithTies = (rows, n, value) => {
	if (rows.length <= n) {
		return [...rows];
	}

	const cut = value(rows[n - 1]);
	let end = n;
	while (end < rows.length && value(rows[end]) === cut) {
		end++;
	}

	return rows.slice(0, end);
};

/** "1 year, 2 months, 3 weeks, 1 day, 5 hours, 10 minutes" */
const formatMinutes = (minutes) => {
	if (minutes === 0) {
		return '0 seconds';
	}

	const parts = [];
	const units = [
		[Math.floor(minutes / (60 * 24 * 365)), 'year'],
		[Math.floor((minutes % (60 * 24 * 365)) / (60 * 24 * 30)), 'month'],
		[Math.floor((minutes % (60 * 24 * 30)) / (60 * 24 * 7)), 'week'],
		[Math.floor((minutes % (60 * 24 * 7)) / (60 * 24)), 'day'],
		[Math.floor((minutes % (60 * 24)) / 60), 'hour'],
		[minutes % 60, 'minute'],
	];
	for (const [value, unit] of units) {
		if (value > 0) {
			parts.push(value === 1 ? `1 ${unit}` : `${value} ${unit}s`);
		}
	}

	return parts.join(', ');
};

/** "2h 5m" */
const formatHours = (minutes) => {
	const h = Math.floor(minutes / 60);
	return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes % 60}m`;
};

/** Eintraege auf Nachrichten bis limit Zeichen verteilen, keinen Eintrag zerreissen */
const packLines = (head, lines, limit, separator = ' | ', repeatHead = true) => {
	const chunks = [];
	let current = head;
	for (const line of lines) {
		const atStart = current === head || current === '';
		const piece = (atStart ? '' : separator) + line;
		if (!atStart && current.length + piece.length > limit) {
			chunks.push(current);
			current = (repeatHead ? head : '') + line;
		} else {
			current += piece;
		}
	}

	chunks.push(current);
	return chunks;
};

/** Eine Antwort oder mehrere Nachrichten mit 400 ms Pause (Twitchs Spam-Schutz, sb-v2 17.09.2026) */
const replyInChunks = async (msg, chunks, delay = 400) => {
	if (chunks.length === 1) {
		return { text: chunks[0] };
	}

	for (let i = 0; i < chunks.length; i++) {
		if (i > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
		await msg.send(i === chunks.length - 1 ? withTrigger(chunks[i], msg) : chunks[i]);
	}

	return { text: null };
};

/** "3", "top3", "top 3" als Argument von vsall/vs: Hinweis auf !vstop statt Nutzersuche; sonst null */
const topListHint = (arg) => {
	const match = /^(?:top)?(\d{1,2})$/i.exec(arg ?? '');
	return match ? `for the top list use !vstop ${match[1]} (or !vstop ${match[1]} all for every channel).` : null;
};

/**
 * Streak-Beginn aus dem letzten geteilten Wert schaetzen (ninou2, 03.11.2026: "compare the number to the dates when the streamer
 * streamed", "better tell when the 1st started"): Wert N am Tag D lag N-1 Streamtage davor. Nur eine Schaetzung, der Streak zaehlt
 * Streams, gespeichert sind Tage. null, wenn der Teilungstag fehlt oder zu wenige Tage bekannt sind (Channel nicht lueckenlos getrackt).
 */
const estimateStreakStart = (days, sharedDay, value) => {
	const known = [...new Set(days)].sort();
	const index = known.indexOf(sharedDay);
	return index === -1 || value < 1 || index < value - 1 ? null : known[index - (value - 1)];
};

const formatStreakStart = (login, channel, row, days) => {
	const sharedDay = toDate(row.Seen_At).toISOString().slice(0, 10);
	const estimate = estimateStreakStart(days, sharedDay, row.Value);
	const first = row.First_Value && row.First_Seen_At ? `first shared streak: ${row.First_Value} on ${fmtDate(toDate(row.First_Seen_At).toISOString().slice(0, 10))}` : null;

	if (estimate) {
		return `${login}'s streak in #${channel} started around ${fmtDate(estimate)} (estimated from ${row.Value} on ${fmtDate(sharedDay)})${first ? `, ${first}` : ''}`;
	}

	return first ? `${login} in #${channel}: ${first}` : `${login} has no start date in #${channel}, the stream days don't go back far enough for a streak of ${row.Value}`;
};

module.exports = {
	ordinal,
	formatSharedDate,
	formatShortDate,
	takeWithTies,
	formatMinutes,
	formatHours,
	packLines,
	replyInChunks,
	topListHint,
	estimateStreakStart,
	formatStreakStart,
};
