// Auswertung der globalen Banphrases fuer !bpstats, aus sb-v2 (v2/utils/banphrase-stats.ts)
/**
 * Auswertung der globalen Banphrasen: wer trifft, wer nie, wie alt (fuer !bpstats).
 * Trefferzahlen kommen aus banphrase_triggers (jeder Treffer, auch Preset-/Channel-
 * Phrasen), nicht aus ban_phrases.trigger_count — der zaehlt nur einen Teil.
 */

const DAY_MS = 86_400_000;
const oneLine = (s, max = 90) => {
	const t = String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const daysSince = (d, now) => {
	const t = d ? new Date(d).getTime() : NaN;
	return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY_MS));
};
const key = (s) => String(s).toLowerCase();

/**
 * Bericht als Text. minUnusedDays blendet in der "keine Treffer"-Liste alles
 * aus, was juenger ist (0 = alles). Die Zusammenfassung zaehlt immer alle.
 * Treffer werden ueber den Phrasen-Wortlaut zugeordnet (Gross/Klein egal).
 */
function buildReport(phrases, triggers, now = Date.now(), minUnusedDays = 0) {
	const byPhrase = new Map(triggers.map((t) => [key(t.phrase), t]));
	const known = new Set(phrases.map((p) => key(p.phrase)));

	const rows = phrases.map((p) => {
		const t = byPhrase.get(key(p.phrase));
		return {
			p,
			hits: t?.hits ?? 0,
			days: daysSince(p.created_at, now) ?? 0,
			last: daysSince(t?.lastHit, now),
			// Beobachtungszeitraum fuer die Rate: Treffer koennen aelter sein als der globale Eintrag
			// (die Phrase stand vorher schon in einem Preset oder Channel)
			span: Math.max(daysSince(p.created_at, now) ?? 0, daysSince(t?.firstHit, now) ?? 0),
			id: String(p.uuid ?? '?').slice(0, 8),
			label: p.name ? `${p.name}: ` : '',
			kind: Number(p.is_regex) ? 're ' : 'lit',
		};
	});
	const used = rows.filter((r) => r.hits > 0).sort((a, b) => b.hits - a.hits || b.days - a.days);
	const unusedAll = rows.filter((r) => r.hits === 0);
	const unused = unusedAll.filter((r) => r.days >= minUnusedDays).sort((a, b) => b.days - a.days);
	const others = triggers.filter((t) => !known.has(key(t.phrase))).sort((a, b) => b.hits - a.hits);
	const triggerSum = rows.reduce((s, r) => s + r.hits, 0);

	const summary = {
		total: rows.length,
		withHits: used.length,
		unused: unusedAll.length,
		triggers: triggerSum,
		shown: unused.length,
		otherPhrases: others.length,
		otherTriggers: others.reduce((s, t) => s + t.hits, 0),
	};
	const lastText = (d) => (d === null ? '   ?' : d === 0 ? 'today' : `${d}d ago`).padStart(8);
	const line = (r, head) => `${head}  ${String(r.days).padStart(4)}d  ${r.id}  ${r.kind}  ${r.label}${oneLine(r.p.phrase)}`;

	const text = [
		`Global ban phrases — ${new Date(now).toISOString().slice(0, 10)}`,
		`${summary.total} phrases, ${summary.triggers} matches in total, ${summary.withHits} with hits, ${summary.unused} without hits.`,
		`Plus ${summary.otherTriggers} matches of ${summary.otherPhrases} phrases that are not in this list (presets / channel phrases).`,
		'',
		`── With hits (${used.length}) — hits / per day / last hit / age / id / type / name: phrase`,
		...used.map((r) => line(r, `${String(r.hits).padStart(5)}x  ${(r.hits / Math.max(1, r.span)).toFixed(2).padStart(6)}/d  ${lastText(r.last)}`)),
		'',
		`── Without hits${minUnusedDays ? ` and older than ${minUnusedDays} days` : ''} (${unused.length} of ${unusedAll.length}) — oldest first`,
		...(unused.length ? unused.map((r) => line(r, `    0x                      `)) : ['(none)']),
		'',
		`── Matches of phrases not in the global list (${others.length}) — presets / channel phrases`,
		...(others.length ? others.map((t) => `${String(t.hits).padStart(5)}x  ${lastText(daysSince(t.lastHit, now))}  ${oneLine(t.phrase)}`) : ['(none)']),
		'',
		'Matches come from the Moderation_Phrase_Hit log and are counted by phrase text; the same text in a preset or a channel list is included.',
		'Bans by the link-spam detection or other modules are not banphrase matches and do not show up here.',
		'The id is the start of the UUID — !delbp <id> / !editbp <id>.',
	].join('\n');
	return { text, summary };
}

module.exports = { buildReport };
