// Clip-Hilfen fuer topclip/lastclips, aus sb-v2s v2/utils/topclips.ts
/**
 * Hilfsfunktionen fuer !topclip: Top-N nach Aufrufen sortieren und die Zeilen
 * auf Nachrichten mit Twitch-Laengenlimit verteilen. Reine Funktionen, ohne
 * Netzwerk, damit sie direkt getestet werden koennen.
 *
 * ninou2, 04.10.2026: "maybe make it top 5 clips of all time, even if it post
 * it 2-3 messages".
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "2023-08-20T…" → "20 aug 2023" (UTC, ohne führende Null beim Tag). */
function formatClipDate(iso) {
	const d = iso ? new Date(iso) : null;
	if (!d || Number.isNaN(d.getTime())) return null;
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Die n meistgesehenen Clips, absteigend nach Aufrufen. Schneidet nicht ab, wenn weniger da sind. */
function topByViews(clips, n) {
	return [...clips].sort((a, b) => b.view_count - a.view_count).slice(0, n);
}

/**
 * Die n zuletzt erstellten Clips, absteigend nach created_at — fuer !lastclips
 * (ninou2, 17.10.2026: "maybe a command that shows the last (1 to 10) clips
 * created on a channel"). Helix sortiert Get Clips standardmaessig nicht
 * verlaesslich nach Erstellungsdatum, deshalb hier lokal sortiert, analog zu
 * topByViews oben.
 */
function mostRecent(clips, n) {
	return [...clips].sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()).slice(0, n);
}

/**
 * Eine Zeile: "#1 (1,234 views) [20 aug 2023] https://…" — ohne Titel (ninou2,
 * 04.10.2026: "only keep rank, then Views, then link, no title"), das Datum in
 * eckigen Klammern (ninou2: "add date").
 */
function formatTopClip(rank, clip) {
	const date = formatClipDate(clip.created_at);
	const dated = date ? ` [${date}]` : '';
	return `#${rank} (${clip.view_count.toLocaleString('en-US')} views)${dated} ${clip.url}`;
}

// packLines: utils/tracking-format.ts (gleiche Logik, sb-v2 hatte sie doppelt)

module.exports = { formatClipDate, topByViews, mostRecent, formatTopClip };
