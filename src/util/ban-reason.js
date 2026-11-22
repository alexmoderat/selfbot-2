// Ban-Gruende aus sb-v2 (src/utils/ban-reason.ts) - gleiche Texte, damit Modlogs gleich aussehen
/**
 * Einheitliches Format für automatische Ban-Reasons — angelehnt an den Stil,
 * den Twitchs eigene "Mod Actions"-Seite für andere automatisierte Bots
 * zeigt ("Automated Ban of Monitored User - Viewbot Seller"), Wunsch
 * 20.08.2026. Vorher stand an jeder Stelle einzeln "... (Automated by
 * alexmoderat)" hinten dran.
 *
 * Accountname als Parameter statt fest "alexmoderat" — dieselbe Codebasis
 * läuft auch als kletztenbrot-sb unter einem anderen Account (24.08.2026),
 * der Reason-Text muss dann den jeweils richtigen Namen zeigen.
 */
function formatAutoBanReason(reason, botUsername = 'alexmoderat') {
	return `Automated Ban by ${botUsername} - ${reason}`;
}

/**
 * Eigenes Format nur für Banphrasen-Treffer (banphrase-filter), zurück zum
 * alten Stil "Blocked phrase: X (Automated by Y)" — Wunsch alexmoderat,
 * 01.09.2026. Bewusst getrennt von formatAutoBanReason, das weiterhin ueberall
 * sonst (network-bot-detector, low-trust, automod-queue, ...) unveraendert
 * "Automated Ban by X - Y" liefert.
 * Seit 06.11.2026 "Blocked phrase" statt "Triggered banphrase" - die meisten Treffer sind Timeouts, kein Ban
 * (alexmoderat: "banphrase passt eigentlich auch nicht ganz ne? ist ja timeout").
 */
function formatBanphraseReason(reason, botUsername = 'alexmoderat') {
	return `Blocked phrase: ${reason} (Automated by ${botUsername})`;
}

/**
 * Erkennt Reasons, die der Bot fuer AUTOMATISCHE Bans/Timeouts erzeugt (die beiden Formate
 * oben plus der Follow-Bot-Ban aus follow-announce). Handbefehle (!crossban, !botcheck,
 * !massban ...) haben andere Reasons und zaehlen bewusst nicht dazu. Grundlage des
 * Pro-Channel-Schalters "autoban all" (siehe twitch-api.ts banUser).
 */
function isAutomatedBanReason(reason) {
	const r = String(reason ?? '');
	return r.startsWith('Automated Ban by ') || /\(Automated by [^)]+\)\s*$/.test(r) || r.startsWith('Follow-bot account ');
}

/**
 * "seller bot" ist der Standard-Reason-Text auf allen von alexmoderat
 * moderierten Channels (eigener Channel + alle, wo der Bot Mod ist) — vor
 * der Vereinheitlichung auf "Viewbot Services" (13.08.2026) war das ohnehin
 * der urspruengliche Text. Einzige Ausnahme: ninou2 selbst wollte
 * ausdruecklich "Viewbot Services" behalten. alexmoderat, 01.09.2026:
 * "auf meinen moderated channels + Meine eigenen channels seller bot und
 * bei ninou2 Viewbot Services".
 *
 * Zentral hier statt in banphrase-filter.ts, weil automod-queue.ts dieselbe
 * Logik in einer eigenen, parallelen Implementierung braucht (Nachrichten,
 * die Twitchs eigenes AutoMod zurueckhaelt, laufen NICHT durch
 * banphrase-filter.ts — eigener Code-Pfad, ueber den derselbe
 * "Viewbot Services"-Fall trotzdem raus kann). Beim ersten Umbau
 * (01.09.2026) uebersehen — diversifiedtuberb2g4o/curledplaidszw in
 * im_row1 zeigten trotz Fix weiterhin das alte Format, weil AutoMod sie
 * zuerst abgefangen hatte.
 */
const VIEWBOT_SERVICES_REASON_CHANNELS = new Set(['ninou2']);
function localizeViewbotReason(channel, reason) {
	if (reason !== 'Viewbot Services') return reason;
	return VIEWBOT_SERVICES_REASON_CHANNELS.has(channel.toLowerCase()) ? reason : 'seller bot';
}

const MIN_BANPHRASE_REASON_LENGTH = 3;

/**
 * Feste Grund-Auswahl im Dashboard (alexmoderat, 05.11.2026, nach "nigii" mit Grund "Ayri"), dazu "Other" mit
 * Freitext. "Viewbot Services" bleibt nur in ninou2 so, sonst wird es zu "seller bot" (localizeViewbotReason).
 */
const BANPHRASE_REASONS = ['Racism / slur', 'Viewbot Services', 'Self-promotion', 'Spam', 'Harassment', 'Explicit content', 'Extremism'];

/**
 * Pflicht-Grund fuer neue Banphrases (alexmoderat, 05.11.2026: "die reasons sollte ich verpflichten" - nach
 * "nigii" mit Grund "Ayri" bzw. leerem Grund, der dann als Phrase selbst bei Twitch landete).
 * null = in Ordnung, sonst die Fehlermeldung (Englisch, geht an Chat und Dashboard).
 */
function validateBanphraseReason(reason, phrase) {
	const value = (reason ?? '').trim();
	if (!value) {
		return 'a reason is required';
	}
	if (value.length < MIN_BANPHRASE_REASON_LENGTH) {
		return `the reason must be at least ${MIN_BANPHRASE_REASON_LENGTH} characters long`;
	}
	if (value.toLowerCase() === phrase.trim().toLowerCase()) {
		return "the reason can't be the phrase itself";
	}

	return null;
}

module.exports = {
	formatAutoBanReason,
	formatBanphraseReason,
	isAutomatedBanReason,
	localizeViewbotReason,
	MIN_BANPHRASE_REASON_LENGTH,
	BANPHRASE_REASONS,
	validateBanphraseReason,
};
