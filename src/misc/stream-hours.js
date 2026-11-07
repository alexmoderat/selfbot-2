// Aus sb-v2 (v2/utils/stream-hours.ts) uebernommen.
/**
 * Hilfsfunktionen fuer !hoursstreamed: Monat+Jahr aus einem einzelnen Wort wie
 * "january2026" parsen (ninou2, 08.10.2026: "!hs ninou2 january2026").
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "january2026" -> {year: 2026, month: 1, label: "january 2026"}; alles andere -> null. */
function parseMonthYear(raw) {
	const m = raw.toLowerCase().match(/^([a-z]+)(\d{4})$/);
	if (!m) return null;
	const monthIdx = MONTHS.indexOf(m[1]);
	if (monthIdx === -1) return null;
	const year = Number(m[2]);
	return { year, month: monthIdx + 1, label: `${m[1]} ${year}` };
}

/** "2026-01" -> "january 2026", fuer !hoursstreamedhistory's "tracking started on"-Hinweis. */
function formatPeriodLabel(period) {
	const [y, m] = period.split('-');
	return `${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Monatsliste als "*monat* —>[Nh] // *monat* —>[Nh] // ..." (ninou2,
 * 08.10.2026, Beispiel fuer !hsh YYYYmonthly: "*january* —>[2h] //
 * february* —>[100h] // *march* —>[400h] ...." — gleiche Konvention wie die
 * Jahresliste von !hoursstreamedhistory; loest die aeltere "[monat -> Nh]"-
 * Klammerform ab, betrifft auch !hoursstreamed monthly fuer Konsistenz.
 */
function formatMonthlyBreakdown(rows) {
	return rows.map(({ month, seconds }) => `*${MONTHS[month - 1]}* —>[${Math.round(seconds / 3600)}h]`).join(' // ');
}

module.exports = { MONTHS, parseMonthYear, formatPeriodLabel, formatMonthlyBreakdown };
