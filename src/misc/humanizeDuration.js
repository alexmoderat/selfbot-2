/**
 * Zeitspannen formatieren.
 *
 * info.js hatte davon vier Varianten nebeneinander (formatDuration,
 * formatDurationShort, formatDurationDetailed, formatAge), die sich in
 * Trennzeichen und Anzahl der Bestandteile unterschieden. Übrig bleiben zwei,
 * weil nur die beiden unterschiedliche Ergebnisse liefern:
 *
 *   formatDuration  … grob, gerundet ("2y 3mo 5d") — für "vor X"
 *   formatExact     … kalendergenau, mit Sekunden — für Account-Alter
 *
 * Der Unterschied ist nicht kosmetisch: formatDuration rechnet mit 30-Tage-
 * Monaten, formatExact zählt echte Kalendermonate.
 */

/** Gerundet, höchstens drei Bestandteile. */
function formatDuration(ms) {
	const min = Math.floor(ms / 60000);
	const h = Math.floor(min / 60);
	const d = Math.floor(h / 24);
	const mo = Math.floor(d / 30);
	const y = Math.floor(mo / 12);

	const parts = [];
	if (y > 0) parts.push(`${y}y`);
	if (mo % 12 > 0) parts.push(`${mo % 12}mo`);
	if (d % 30 > 0) parts.push(`${d % 30}d`);
	if (h % 24 > 0) parts.push(`${h % 24}h`);
	if (min % 60 > 0) parts.push(`${min % 60}m`);
	return parts.slice(0, 3).join(' ') || '0m';
}

/** Kalendergenau: echte Monatslängen statt 30-Tage-Pauschale. */
function formatExact(ms) {
	const now = new Date();
	const start = new Date(now.getTime() - ms);

	let years = now.getFullYear() - start.getFullYear();
	let months = now.getMonth() - start.getMonth();
	let days = now.getDate() - start.getDate();

	if (days < 0) {
		months--;
		days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
	}
	if (months < 0) {
		years--;
		months += 12;
	}

	const rem = ms % 86400000;
	const hours = Math.floor(rem / 3600000);
	const minutes = Math.floor((rem % 3600000) / 60000);
	const seconds = Math.floor((rem % 60000) / 1000);

	const parts = [];
	if (years > 0) parts.push(`${years}y`);
	if (months > 0) parts.push(`${months}mo`);
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(' ');
}

/** "vor X" aus einem ISO-Datum; null/ungültig → "unknown". */
function ago(dateStr, exact = true) {
	if (!dateStr) return 'unknown';
	const t = new Date(dateStr).getTime();
	if (Number.isNaN(t)) return 'unknown';
	return (exact ? formatExact : formatDuration)(Date.now() - t);
}

/** "3h", "14h24m", "90m" - Ziffern + Einheit (d/h/m/s) beliebig oft, in beliebiger Reihenfolge; null ohne Treffer */
function parseDurationText(input) {
	const regex = /(\d+)\s*(d|h|m|s)/gi;
	const multipliers = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };
	let ms = 0;
	let matched = false;
	for (const match of input.matchAll(regex)) {
		matched = true;
		ms += Number(match[1]) * multipliers[match[2].toLowerCase()];
	}

	return matched ? ms : null;
}

const humanize = require('humanize-duration');

/** Kurzform wie "1d 2h" (y/mo/d/h/m/s), largest = Anzahl Einheiten */
const short = (ms, largest) => {
	const options = {
		language: 'shortEn',
		languages: {
			shortEn: {
				y: () => 'y',
				mo: () => 'mo',
				w: () => 'w',
				d: () => 'd',
				h: () => 'h',
				m: () => 'm',
				s: () => 's',
				ms: () => 'ms',
			},
		},
		units: ['y', 'mo', 'd', 'h', 'm', 's'],
		largest: largest ?? 4,
		round: true,
		conjunction: ' and ',
		spacer: '',
	};
	return humanize(ms, options);
};

module.exports = { short, formatDuration, formatExact, ago, parseDurationText };
