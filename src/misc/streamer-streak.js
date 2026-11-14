// Aus sb-v2 (v2/utils/streamer-streak.ts) uebernommen.

// ninou2, 28.10.2026: "make it to not register the stream data or count it as a stream if a stream under 5min" -
// Kurz-Streams (Server-Probleme, sofort wieder offline) zaehlen weder als Tag noch fuer !lastlive oder Stunden
// (crons/streamer-streak, commands/lastlive).
const MIN_STREAM_SECONDS = 5 * 60;
/**
 * Reine Streak-Berechnung aus einer Liste von UTC-Kalendertagen ('YYYY-MM-DD'),
 * an denen ein Channel live war — getrennt von der DB (streamer-streak-maria.ts),
 * damit sich die Logik ohne MariaDB testen laesst.
 */

function toEpochDay(day) {
	return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

function epochDayToStr(epoch) {
	return new Date(epoch * 86_400_000).toISOString().slice(0, 10);
}

/** sortedUniqueDays muss bereits sortiert und eindeutig sein — geteilt zwischen computeStreak und yearlyBreakdown. */
function longestRunInDays(sortedUniqueDays) {
	if (!sortedUniqueDays.length) return { longest: 0, start: null, end: null, ties: 0 };

	let longest = 1;
	let start = sortedUniqueDays[0];
	let end = sortedUniqueDays[0];
	let runStart = sortedUniqueDays[0];
	let runLen = 1;
	const runLengths = [];

	for (let i = 1; i < sortedUniqueDays.length; i++) {
		if (toEpochDay(sortedUniqueDays[i]) === toEpochDay(sortedUniqueDays[i - 1]) + 1) {
			runLen++;
		} else {
			runLengths.push(runLen);
			runStart = sortedUniqueDays[i];
			runLen = 1;
		}
		// strikt ">": bei Gleichstand bleibt der zeitlich ERSTE Streak angezeigt
		if (runLen > longest) {
			longest = runLen;
			start = runStart;
			end = sortedUniqueDays[i];
		}
	}
	runLengths.push(runLen);

	return { longest, start, end, ties: runLengths.filter((l) => l === longest).length };
}

/**
 * Alle zusammenhaengenden Streaks (nicht nur den laengsten), absteigend nach
 * Laenge, auf die besten n gekuerzt — fuer "!ss top3" (ninou2, 17.10.2026,
 * direkt nach der muehsamen Handsuche nach ninou2s "150-145 Tage"-Streak:
 * "i would say to make a command variant that tells a person top 3 streak
 * all time"). days muss nicht sortiert/eindeutig sein.
 */
function topStreaks(days, n) {
	const unique = [...new Set(days)].sort();
	if (!unique.length) return [];

	const runs = [];
	let runStart = unique[0];
	let runLen = 1;
	for (let i = 1; i < unique.length; i++) {
		if (toEpochDay(unique[i]) === toEpochDay(unique[i - 1]) + 1) {
			runLen++;
		} else {
			runs.push({ length: runLen, start: runStart, end: unique[i - 1] });
			runStart = unique[i];
			runLen = 1;
		}
	}
	runs.push({ length: runLen, start: runStart, end: unique[unique.length - 1] });

	return runs.sort((a, b) => b.length - a.length).slice(0, n);
}

/** days muss nicht sortiert/eindeutig sein. today = heutiger UTC-Kalendertag ('YYYY-MM-DD'). */
function computeStreak(days, today) {
	const unique = [...new Set(days)].sort();
	if (!unique.length) {
		return { current: 0, currentSince: null, longest: 0, longestStart: null, longestEnd: null, longestTies: 0 };
	}

	const { longest, start: longestStart, end: longestEnd, ties: longestTies } = longestRunInDays(unique);

	// Aktuelle Serie: rueckwaerts ab heute zaehlen — Gnadenfrist bis Ende des Tages,
	// falls heute noch nicht (wieder) gestreamt wurde, dann eben ab gestern.
	const daySet = new Set(unique.map(toEpochDay));
	let anchor = toEpochDay(today);
	if (!daySet.has(anchor)) anchor -= 1;

	let current = 0;
	let cursor = anchor;
	while (daySet.has(cursor)) {
		current++;
		cursor--;
	}
	const currentSince = current > 0 ? epochDayToStr(anchor - current + 1) : null;

	return { current, currentSince, longest, longestStart, longestEnd, longestTies };
}

/** "1st", "2nd", "3rd", "4th" ... — geteilt zwischen den Streak-Commands fuer einheitliche Datumsformate. */
function ordinal(n) {
	const v = n % 100;
	if (v >= 11 && v <= 13) return `${n}th`;
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
}

/** 365 oder 366, je nach Schaltjahr. */
function daysInYear(year) {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** Anzahl eindeutiger Streaming-Tage eines Kalenderjahres (ninou2 alexmoderat, 29.09.2026: "x/365 so far"). */
function countDaysInYear(days, year) {
	const prefix = `${year}-`;
	return new Set(days.filter((d) => d.startsWith(prefix))).size;
}

/**
 * X/365 fuer jedes Jahr, in dem mindestens ein Streaming-Tag aufgezeichnet wurde
 * — ninou2, 29.09.2026: "at the end of each year ... should be saved" befuerchtete,
 * die Werte vergangener Jahre gingen verloren, sobald das neue Jahr beginnt. Braucht
 * es nicht: jeder Tag steht einzeln in der DB, die Jahreswerte lassen sich jederzeit
 * aus den vorhandenen Tagen neu berechnen, nichts muss vorab "archiviert" werden.
 * Der laengste Streak pro Jahr zaehlt nur Tage innerhalb dieses Jahres (ninou2,
 * 29.09.2026: "it WOULD be great if the longest streak each year AND when it
 * happened be added to it too").
 */
function yearlyBreakdown(days) {
	const byYear = new Map();
	for (const d of new Set(days)) {
		const year = Number(d.slice(0, 4));
		if (!byYear.has(year)) byYear.set(year, new Set());
		byYear.get(year).add(d);
	}
	return [...byYear.keys()]
		.sort((a, b) => a - b)
		.map((year) => {
			const yearDays = [...byYear.get(year)].sort();
			const { longest, start, end, ties } = longestRunInDays(yearDays);
			return { year, count: yearDays.length, total: daysInYear(year), longestStreak: longest, longestStart: start, longestEnd: end, longestTies: ties };
		});
}

/** "june 7th 2025" — exakter Wortlaut auf ninou2s Wunsch (29.09.2026), nicht die uebliche Kurzform. Geteilt zwischen streamerstreak und streamerstreakhistory. */
function fmtDate(day) {
	const d = new Date(`${day}T00:00:00Z`);
	const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
	return `${month} ${ordinal(d.getUTCDate())} ${d.getUTCFullYear()}`;
}

/**
 * Hinweis fuer die Streak-Commands, wenn mehrere getrennte Streaks gleich lang
 * die Spitze bilden (ninou2, 02.10.2026: "would be great if the bot can tell that
 * there is multiple streaks at the top , even if he only show the time period of
 * the 1st one that happened during the year"). Leer, wenn es nur einen gibt.
 */
function tiesNote(ties) {
	return ties > 1 ? ` (first of ${ties} streaks with this length)` : '';
}

/** "today" / "1 day ago" / "28 days ago" — Abstand zweier UTC-Kalendertage ('YYYY-MM-DD'). */
function daysAgoText(day, today) {
	const n = toEpochDay(today) - toEpochDay(day);
	if (n <= 0) return 'today';
	return n === 1 ? '1 day ago' : `${n} days ago`;
}

/** "10/11/26" (Tag/Monat/Jahr) aus "2026-11-10" */
function fmtShortDate(day) {
	const [year, month, date] = String(day).slice(0, 10).split('-');
	return `${date}/${month}/${year.slice(2)}`;
}

/** "2 days ago 10/11/26": Tagesabstand plus Datum (ninou2, 12.11.2026: "to add the date as X/X/X") */
function daysAgoWithDate(day, today) {
	return `${daysAgoText(day, today)} ${fmtShortDate(day)}`;
}

/** "october 1st 2026 18:59 UTC" aus einem ISO-Zeitstempel. */
function fmtDateTimeUtc(iso) {
	const d = new Date(iso);
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mm = String(d.getUTCMinutes()).padStart(2, '0');
	return `${fmtDate(d.toISOString().slice(0, 10))} ${hh}:${mm} UTC`;
}

const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** "6h 20min" / "59min" (Leerzeichen zwischen Stunden und Minuten; ninou2, 14.11.2026: "make it always space between hours and minutes"). */
function fmtLengthShort(ms) {
	const totalMin = Math.max(0, Math.floor(ms / 60_000));
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/**
 * "october 1st 2026 [13:18 UTC to 18:01 UTC, ⏱4h43min]" (ninou2, 02./03.10.2026: Zeitraum,
 * dann "maybe the leght of the stream too", dann die Uhr davor). Endet der Stream an einem spaeteren
 * UTC-Tag, steht "+1d" (usw.) hinter der Endzeit.
 */
function fmtStreamSpanUtc(startIso, endIso) {
	const s = new Date(startIso);
	const e = new Date(endIso);
	const dayDiff = Math.round(
		(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())) / 86_400_000,
	);
	const plus = dayDiff > 0 ? ` +${dayDiff}d` : '';
	return `${fmtDate(s.toISOString().slice(0, 10))} [${hhmm(s)} UTC to ${hhmm(e)} UTC${plus}, ⏱${fmtLengthShort(e.getTime() - s.getTime())}]`;
}

module.exports = {
	MIN_STREAM_SECONDS,
	topStreaks,
	computeStreak,
	ordinal,
	daysInYear,
	countDaysInYear,
	yearlyBreakdown,
	fmtDate,
	tiesNote,
	daysAgoText,
	daysAgoWithDate,
	fmtShortDate,
	fmtDateTimeUtc,
	fmtLengthShort,
	fmtStreamSpanUtc,
};
