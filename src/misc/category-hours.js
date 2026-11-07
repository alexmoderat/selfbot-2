// Aus sb-v2 (v2/utils/category-hours.ts) uebernommen.
/**
 * Reine Formatierungs-Hilfsfunktionen fuer !hoursstreamedcategories/!hsc und
 * !hoursstreamedcategorieshistory/!hsch. Das Jahr/Monat-Parsen selbst nutzt
 * das bereits bestehende parseMonthYear() aus stream-hours.ts (!hoursstreamed/
 * !hs) -- keine zweite Parser-Implementierung fuer dasselbe Format.
 */

/** "1h 53min" / "1h" / "45min" -- wie bei den "games played"-Segmenten in der Offline-Meldung. */
function formatCategoryDuration(minutes) {
	if (minutes < 60) return `${minutes}min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m ? `${h}h ${m}min` : `${h}h`;
}

/** Einzelne "[Kategorie] Dauer"-Stuecke, fuer Faelle, die sie ggf. selbst chunken muessen. */
function formatCategoryParts(rows) {
	return rows.filter((r) => r.minutes >= 1).map((r) => `[${r.category}] ${formatCategoryDuration(r.minutes)}`);
}

function formatCategoryBreakdown(rows) {
	const parts = formatCategoryParts(rows);
	return parts.length ? parts.join(' ') : null;
}

/** Exakter Treffer (ohne Gross-/Kleinschreibung) gewinnt, sonst alle Kategorien, die den Suchbegriff enthalten. */
function matchCategories(rows, query) {
	const term = query.trim().toLowerCase();
	const exact = rows.filter((r) => r.category.toLowerCase() === term);
	return exact.length ? exact : rows.filter((r) => r.category.toLowerCase().includes(term));
}

module.exports = { formatCategoryDuration, formatCategoryParts, formatCategoryBreakdown, matchCategories };
