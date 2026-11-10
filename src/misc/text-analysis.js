// Textanalyse fuer die Moderation aus sb-v2 (v2/utils/text-analysis.ts): Deobfuskierung, Domains, Link-Spam.
// Reine Funktionen ohne Seiteneffekte, einzeln testbar.
// Nur echte, tatsächlich für Spam missbrauchte TLDs statt beliebiger 2+-Buchstaben-
// Endungen. Vorfall #rileylume, 11.08.2026: eine Entschuldigungsnachricht in
// durchgehender Kleinschreibung ("...entspannt. es tut mir..." / "...oder so. ich
// werd...") wurde als "Viewbot Services" gebannt, weil ".es" und ".ich" als TLD
// durchgingen — kurze deutsche Wörter wie "es"/"in"/"am"/"de"/"im" sind zufällig
// auch echte ccTLDs. Die alte Regex akzeptierte JEDES Wort ab 2 Buchstaben als
// TLD, nicht nur die, die unsere Spam-Domains tatsächlich benutzen (siehe
// ban_phrases: fast ausschließlich .ru/.online). Feste Liste schließt diese
// Kollisionen aus, ohne echte Spam-Domains zu verpassen.
const SPAM_TLDS = [
	'com',
	'net',
	'org',
	'ru',
	'online',
	'xyz',
	'top',
	'click',
	'site',
	'club',
	'live',
	'cc',
	'ws',
	'biz',
	'info',
	'pro',
	'gg',
	'tv',
	'io',
	'link',
	'lol',
	'fun',
	'icu',
	'host',
	'monster',
	'buzz',
	'shop',
	'store',
	'win',
	'bid',
	'stream',
	'vip',
	'wtf',
	'cf',
	'ga',
	'ml',
	'tk',
	'cyou',
	'rest',
	'sbs',
	'lat',
	'cfd',
	'beauty',
	'autos',
	'quest',
	'dev',
	'app',
];
const DOMAIN_REGEX = new RegExp(`\\b(?:https?://)?(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${SPAM_TLDS.join('|')})(?:/\\S*)?\\b`, 'gi');

const PROMO_KEYWORDS = ['follow me', 'top viewers', 'best viewers', 'cheap viewers', 'buy viewers', 'viewers', 'seller', 'promo', 'advert', 'ad service'];

const TRUSTED_BOT_USERS = new Set(['nightbot', 'streamelements', 'fossabot', 'moobot', 'sery_bot', 'wizebot', 'streamlabs', 'supibot']);

const ALLOWLISTED_DOMAIN_SUFFIXES = [
	'twitch.tv',
	'youtube.com',
	'youtu.be',
	'twitter.com',
	'x.com',
	'instagram.com',
	'tiktok.com',
	'reddit.com',
	'discord.gg',
	'discord.com',
	'steamcommunity.com',
	'guns.lol',
	'haunt.gg',
	'lilb.dev',
	'linktr.ee',
	'beacons.ai',
	'solo.to',
];

// ── Deobfuskierung ───────────────────────────────────────────────────────────

const SMALL_CAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ';
const NORMAL_AZ = 'abcdefghijklmnopqrstuvwxyz';
const _scMap = Object.fromEntries([...SMALL_CAPS].map((c, i) => [c, NORMAL_AZ[i]]));

const normalizeSmallCaps = (text) => [...text].map((c) => _scMap[c] ?? c).join('');

/**
 * Entfernt Zero-Width-Spaces, kombinierende Zeichen und andere unsichtbare
 * Unicode-Zeichen.
 *
 * NFKD statt NFD: NFD zerlegt nur Akzente, laesst stilisierte Buchstaben aber
 * stehen. Ein Spammer schrieb "A𝗶 vîewers" — das î wurde sauber zu i, das
 * mathematische Fett-i (U+1D5F6) blieb, und damit lief die Nachricht an allen
 * Banphrases vorbei. NFKD fasst diese Bloecke mit ab: Fett, Kursiv, Fullwidth,
 * Kapitaelchen. Nebenwirkung auf harmlosen Text ist gering und unschaedlich
 * (½ → 1⁄2, x² → x2) — in keiner Banphrase kommt so etwas vor.
 */
const stripInvisible = (text) =>
	text
		.normalize('NFKD')
		.replace(/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g, '')
		.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u034F\u115F\u1160]/g, '');

// "Durchgestrichene" Buchstaben (ø, ł, đ ...) sind eigene Unicode-Codepunkte,
// kein Basisbuchstabe+Akzent — NFKD zerlegt sie NICHT, anders als à/é/î.
// Vorfall #ghostsha_dowj713, 13.08.2026: "yøur stréam" — stréam wurde durch
// NFKD sauber zu "stream", yøur blieb "yøur" und lief an allen Banphrases
// vorbei.
const _strokeMap = {
	ø: 'o',
	Ø: 'O',
	ł: 'l',
	Ł: 'L',
	đ: 'd',
	Đ: 'D',
	ɵ: 'o',
	ǝ: 'e',
};
const normalizeStrokeLetters = (text) => [...text].map((c) => _strokeMap[c] ?? c).join('');

// Canadian-Aboriginal-Syllabics-Block als Latein-Lookalike-Font missbraucht
// ("VIEWERS ON THE STREAM..." wurde als "ᐯIEᗯEᖇS Oᑎ TᕼE STᖇEᗩᗰ..." gepostet,
// #th3chabelita, 22.08.2026) — NFKD zerlegt diese Zeichen nicht, da es echte
// eigenständige Codepunkte sind, kein Latein+Diakritikum.
// Kleinbuchstaben, weil die Aufrufer schon vorher kleinschreiben (Syllabics haben keine Gross-/Kleinschreibung):
// mit "V"/"W" wurde "ᐯIEᗯS" zu "VieWs" und lief an jeder normalen Banphrase vorbei (#alex_sbottats, 26.10.2026)
const _syllabicsMap = {
	ᗩ: 'a',
	ᗷ: 'b',
	ᗪ: 'd',
	ᖴ: 'f',
	ᕼ: 'h',
	ᒍ: 'j',
	ᒪ: 'l',
	ᗰ: 'm',
	ᑎ: 'n',
	ᑭ: 'p',
	ᖇ: 'r',
	ᑌ: 'u',
	ᐯ: 'v',
	ᗯ: 'w',
	ᕽ: 'x',
};
const normalizeSyllabics = (text) => [...text].map((c) => _syllabicsMap[c] ?? c).join('');

/** Macht aus "s.p.a.m" wieder "spam". */
function deobfuscate(text) {
	return normalizeSmallCaps(normalizeSyllabics(normalizeStrokeLetters(stripInvisible(text)))).replace(/\b([a-z])(\.[a-z]){2,}\b/gi, (m) =>
		m.replace(/\./g, ''),
	);
}

// ── Domains ──────────────────────────────────────────────────────────────────

const normalizeDomain = (raw) =>
	raw
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.split('/')[0]
		.split('?')[0]
		.split('#')[0]
		.replace(/:\d+$/, '');

// Leetspeak-Ziffern in Buchstaben zurückübersetzen, NUR für die Domain-
// Erkennung — sonst würde z.B. "seit 3 tagen" zu "seit e tagen" verstümmelt
// und Banphrase-/Promo-Wort-Vergleiche verfälschen. Vorfall #ahatedn,
// 12.08.2026: "pushfyp .c0m" (Null statt o) lief an DOMAIN_REGEX vorbei, weil
// "c0m" keine unserer echten TLDs ist.
const LEET_MAP = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };
const deleetify = (text) => text.replace(/[013457]/g, (c) => LEET_MAP[c] ?? c);

const getUniqueDomains = (text) => [...new Set((deleetify(text).match(DOMAIN_REGEX) || []).map(normalizeDomain).filter(Boolean))];

const isAllowlistedDomain = (domain) => ALLOWLISTED_DOMAIN_SUFFIXES.some((s) => domain === s || domain.endsWith(`.${s}`));

/**
 * Mods, Broadcaster, bekannte Bots, VIPs und Subs werden nie gefiltert.
 * alexmoderat, 17.09.2026: "warum ignoriert mein bot kein vip und sub" -- pauschal fuer den ganzen
 * Filter (Banphrasen UND Link-Spam). Tradeoff bewusst: ein Seller-Bot mit gekauftem Sub kaeme durch.
 * Im selfbot aus den Twitch-Badges der Nachricht abgeleitet (sb-v2 hatte dafuer eigene User-Felder).
 */
/** Badge-Sets, die als Mod zaehlen ("lead_moderator" = vom Broadcaster befoerderter Mod) */
const MODERATOR_BADGES = new Set(['moderator', 'lead_moderator']);

const rolesFromBadges = (name, badges) => {
	const ids = new Set(badges.map((i) => i.set_id));
	return {
		name,
		isMod: [...MODERATOR_BADGES].some((i) => ids.has(i)),
		isBroadcaster: ids.has('broadcaster'),
		isVip: ids.has('vip'),
		isSubscriber: ids.has('subscriber') || ids.has('founder'),
	};
};

function isTrustedSender(user) {
	if (TRUSTED_BOT_USERS.has(user.name?.toLowerCase() ?? '')) {
		return true;
	}

	return Boolean(user.isMod || user.isBroadcaster || user.isVip || user.isSubscriber);
}

// ── Link-Spam ────────────────────────────────────────────────────────────────

/**
 * Abgestufte Regeln, absteigend nach Strenge. Identisch zum alten Verhalten:
 *   1. Ban-Evader + mindestens ein verdächtiger Link
 *   2. Verdächtiger User + Link + Promo-Wort
 *   3. Drei oder mehr verdächtige Domains
 *   4. Ein Link + Promo-Wort
 *
 * @returns {{reason: string, domains: string[]}|null}
 */
function getLinkSpamReason(messageText, { isSuspicious = false, isBanEvader = false, isTrusted = false } = {}) {
	if (isTrusted) return null;

	// ohne collapseDomainSpaces lief "promotion. ru" (Leerzeichen vor der TLD)
	// an DOMAIN_REGEX vorbei — traf bei suspicious/low-trust Usern schon zu
	// (siehe getSuspiciousLinkReason), bei regulären Usern bislang nicht.
	// Vorfall #prodblck, 05.08.2026: manuell gebannt, weil weder Banphrase noch
	// Link-Spam-Erkennung angeschlagen haben.
	//
	// collapseDomainSpaces MUSS vor dem Kleinschreiben laufen: sein Regex prüft
	// bewusst, ob das Wort nach dem Punkt komplett klein geschrieben ist — das
	// ist der Unterschied zwischen einem echten Bypass ("promotion. ru") und
	// einem ganz normalen Satzende ("...followers. She loves..."). Erst NACH
	// dem Collapse kleinschreiben, sonst sieht "She" wie "she" aus und jeder
	// mehrsätzige Text wird faelschlich als Domain-Spam gewertet (Vorfall
	// #thehustler25, 07.08.2026 — DM-Scam-Text wurde per Zufall richtig
	// gebannt, aber nur weil der Bug normale Satzzeichen als Domains gelesen
	// hat, nicht wegen eines echten Links).
	// deleetify VOR collapseDomainSpaces: dessen TLD-Gruppe ([a-z]{2,}) matcht
	// keine Ziffern, "pushfyp .c0m" würde sonst gar nicht erst zusammengezogen.
	const lower = deobfuscate(collapseDomainSpaces(deleetify(messageText))).toLowerCase();
	const suspicious = getUniqueDomains(lower).filter((d) => !isAllowlistedDomain(d));
	const hasPromo = PROMO_KEYWORDS.some((k) => lower.includes(k));

	if (isBanEvader && suspicious.length >= 1) {
		return { reason: `Restricted user posted suspicious link (${suspicious.join(', ')})`, domains: suspicious };
	}
	if (isSuspicious && suspicious.length >= 1 && hasPromo) {
		return { reason: `Suspicious promo link (${suspicious.join(', ')})`, domains: suspicious };
	}
	if (suspicious.length >= 3) {
		return { reason: `Multi-domain spam (${suspicious.length} suspicious domains)`, domains: suspicious };
	}
	if (suspicious.length >= 1 && hasPromo) {
		return { reason: `Promo link spam (${suspicious.join(', ')})`, domains: suspicious };
	}
	return null;
}

// ── Variante für Low-Trust-User (aus suspicious-handler.js) ──────────────────
//
// Diese Prüfung ist absichtlich strenger als getLinkSpamReason:
//   * "site . com" wird zu "site.com" zusammengezogen
//   * KEINE Allowlist — bei markierten Usern zählen auch twitch.tv-Links mit
// Beides war nur in suspicious-handler.js so implementiert; die drei Kopien der
// Logik im alten Code waren nicht deckungsgleich.

const PROMO_PHRASE_PATTERNS = [
	/(?:buy|cheap|best|top)\s+viewers?/i,
	/(?:buy|cheap|best|top)\s+followers?/i,
	/free\s+followers?/i,
	/follow\s+me/i,
	/check\s+my\s+profile/i,
	/promo(?:tion)?/i,
	/ad\s*service/i,
	/seller/i,
];

// Kürzere Liste als PROMO_KEYWORDS — ohne "follow me", das steckt in den Patterns
const LOWTRUST_PROMO_KEYWORDS = ['top viewers', 'best viewers', 'cheap viewers', 'buy viewers', 'viewers', 'seller', 'promo', 'advert', 'ad service'];

const collapseDomainSpaces = (text) => text.replace(/([a-z0-9-])\s*\.\s*([a-z]{2,})/g, '$1.$2');

// ── Versteckte Links ─────────────────────────────────────────────────────────
//
// Vorfall #pearsbott, 10.11.2026: "Have you checked out d       o        v        i        e .tv yet?" lief an allen
// Banphrases und am Link-Spam vorbei (kein Werbewort, und collapseDomainSpaces machte nur "e.tv" daraus); vorher
// 02.11.2026 "Check out dovie .tv". Wer einen Link absichtlich zerlegt, ist ein Spam-Bot (alexmoderat, 10.11.2026:
// "die Methode die der typ genutzt hat ist ja auch schon bot artig") - das Verstecken selbst ist das Signal.
//
// Bewusst NICHT als versteckt zaehlt "wort. tld" (Leerzeichen nur NACH dem Punkt): das ist ein normales Satzende in
// kleingeschriebenem Chat ("ok. live soon", Vorfall #rileylume). Versteckt heisst: Leerzeichen VOR dem Punkt
// ("dovie .tv"), Einzelbuchstaben mit Leerraum ("d o v i e") oder ein ausgeschriebener Punkt ("dovie (dot) tv").

// Mindestens drei Einzelzeichen hintereinander, damit "a b" in normalen Saetzen stehen bleibt
const joinSpacedLetters = (text) =>
	text
		.replace(/(?<![a-z0-9])[a-z0-9](?:\s+[a-z0-9](?![a-z0-9])){2,}/gi, (m) => m.replace(/\s+/g, ''))
		// TLD in Einzelbuchstaben hinter einem Punkt: ". t v"
		.replace(/\.\s*((?:[a-z]\s+){1,5}[a-z])(?![a-z0-9])/gi, (_, tld) => `.${tld.replace(/\s+/g, '')}`);

// TLDs, die im Chat als eigenes Wort mit Punkt davor vorkommen ("nice .gg", "that was .lol") - fuer die
// Versteckt-Erkennung zu riskant. Gelernte Spam-Domains mit diesen Endungen greifen trotzdem (getMessageDomains).
const CHAT_WORD_TLDS = new Set(['gg', 'lol', 'live', 'top', 'win', 'fun', 'wtf', 'pro', 'vip', 'club', 'stream', 'rest', 'quest', 'monster', 'shop']);

// Nur fuer versteckte Links und gelernte Spam-Domains ausgenommen, nicht fuer den normalen Link-Spam
// (alexmoderat, 10.11.2026: "das mit kick da gabs schon 1x fehlalarm")
const SPAM_DOMAIN_EXEMPT = ['kick.com'];
const isSpamDomainExempt = (domain) => isAllowlistedDomain(domain) || SPAM_DOMAIN_EXEMPT.some((s) => domain === s || domain.endsWith(`.${s}`));

const DOT_WORD = /\s*(?:[([{]\s*(?:dot|\.)\s*[)\]}]|\s+dot\s+)\s*/gi;
const collapseSpaceBeforeDot = (text) => text.replace(/([a-z0-9-])\s+\.\s*([a-z]{2,})/g, '$1.$2');

const domainsIn = (text) => [...new Set((text.match(DOMAIN_REGEX) || []).map(normalizeDomain).filter(Boolean))];

/** Text mit wieder zusammengesetzten versteckten Links, kleingeschrieben */
const revealLinks = (messageText) => collapseSpaceBeforeDot(joinSpacedLetters(deobfuscate(deleetify(messageText)).toLowerCase()).replace(DOT_WORD, '.'));

/**
 * Domains (nicht auf der Allowlist), die nur durch Zusammensetzen sichtbar werden - also absichtlich versteckt sind.
 * @returns {string[]}
 */
function getHiddenDomains(messageText) {
	const plain = new Set(domainsIn(deobfuscate(deleetify(messageText)).toLowerCase()));
	return domainsIn(revealLinks(messageText)).filter((d) => {
		const parts = d.split('.');
		return !plain.has(d) && !isSpamDomainExempt(d) && !CHAT_WORD_TLDS.has(parts.at(-1)) && parts.at(-2).length >= 3;
	});
}

/**
 * Alle Domains einer Nachricht (offen, versteckt, "wort. tld"), ohne Allowlist - fuer den Abgleich mit gelernten
 * Spam-Domains, wo die Domain selbst schon feststeht und die grosszuegige Erkennung kein Risiko ist.
 * @returns {string[]}
 */
function getMessageDomains(messageText) {
	const base = deobfuscate(deleetify(messageText));
	const all = [
		...domainsIn(base.toLowerCase()),
		...domainsIn(revealLinks(messageText)),
		...domainsIn(collapseDomainSpaces(joinSpacedLetters(base.toLowerCase()).replace(DOT_WORD, '.'))),
	];
	return [...new Set(all)].filter((d) => !isSpamDomainExempt(d));
}

/** Ohne stripInvisible — genau wie im alten suspicious-handler. */
const deobfuscateLoose = (text) =>
	normalizeSmallCaps(normalizeSyllabics(normalizeStrokeLetters(text))).replace(/\b([a-z])(\.[a-z]){2,}\b/gi, (m) => m.replace(/\./g, ''));

function getSuspiciousLinkReason(messageText, lowTrustStatus) {
	// Reihenfolge wie in getLinkSpamReason: collapseDomainSpaces braucht die
	// echte Gross-/Kleinschreibung, um Satzenden von Domain-Bypasses zu
	// unterscheiden — erst danach kleinschreiben.
	const collapsed = collapseDomainSpaces(deobfuscateLoose(deleetify(messageText)));
	const lower = collapsed.toLowerCase();
	const domains = [...new Set((collapsed.match(DOMAIN_REGEX) || []).map(normalizeDomain).filter(Boolean))];
	const hasPromo = LOWTRUST_PROMO_KEYWORDS.some((k) => lower.includes(k));

	// Twitch liefert den Status GROSSGESCHRIEBEN ("RESTRICTED"/"ACTIVE_MONITORING");
	// vorher gegen "restricted" verglichen -> Zweig griff nie (96 Log-Samples,
	// 07.09.2026). Einmal klein normalisieren.
	const st = String(lowTrustStatus || '').toLowerCase();

	if (st === 'restricted' && domains.length >= 2) return { reason: 'Viewbot Services', domains };
	if (domains.length >= 3) return { reason: 'Viewbot Services', domains };
	if (domains.length >= 1 && hasPromo) return { reason: 'Viewbot Services', domains };
	return null;
}

// ── Follow-Farm / Discord-Rekrutierung ohne Link ────────────────────────────
//
// Low-Trust-User posten oft eine Rekrutierungs-Masche OHNE echten Link, nur mit
// einem Discord-Namen: "hey fellow streamer, let's support each other, add me on
// discord: <name>". Kein Domain-Treffer, keine Standard-Banphrase greift.
// Vorfall #stewamthy_98 (ninou2, 07.09.2026, RESTRICTED + LIKELY_EVADER):
// "...let's conect and make it official on discord  add me  carrick_son" —
// lief komplett durch, musste 4 Min später manuell gebannt werden.
//
// Nur aus dem Low-Trust-Pfad aufrufen (Twitch hat den User bereits markiert).
// Zwei unabhängige Signale nötig: die Rekrutierungs-Rhetorik (FF_PITCH) UND
// entweder eine Kontakt-Aufforderung (FF_SOLICIT) oder eine Discord-Erwähnung.
const FF_PITCH = [
	/\bfellow streamers?\b/,
	/\bsupport each ?other\b/,
	/\bcheer each ?other\b/,
	/\bstumbled (?:up)?on your (?:channel|stream)\b/,
	/\bcame across your (?:channel|stream)\b/,
	/\b(?:grow together|grow our channels?|help each ?other grow)\b/,
];
const FF_SOLICIT = [
	/\badd me\b/,
	/\b(?:dm|pm|msg|message|text) me\b/,
	/\bhit me up\b/,
	/\bhmu\b/,
	/\bmake it official\b/,
	/\bjoin (?:my|the) (?:discord|server|community)\b/,
	/\blet'?s (?:connect|conect|collab|team up|link up)\b/,
];
const FF_DISCORD = /d[i1l]s\s*\.?\s*c[0o]rd/;

function getFollowFarmReason(messageText) {
	const lower = deobfuscateLoose(
		String(messageText || '')
			.normalize('NFKC')
			.toLowerCase(),
	);
	if (!FF_PITCH.some((re) => re.test(lower))) return null;
	if (!FF_DISCORD.test(lower) && !FF_SOLICIT.some((re) => re.test(lower))) return null;
	return { reason: 'Follow-Farm recruitment' };
}

module.exports = {
	DOMAIN_REGEX,
	PROMO_KEYWORDS,
	TRUSTED_BOT_USERS,
	ALLOWLISTED_DOMAIN_SUFFIXES,
	deobfuscate,
	normalizeDomain,
	deleetify,
	getUniqueDomains,
	isAllowlistedDomain,
	MODERATOR_BADGES,
	rolesFromBadges,
	isTrustedSender,
	getLinkSpamReason,
	PROMO_PHRASE_PATTERNS,
	LOWTRUST_PROMO_KEYWORDS,
	collapseDomainSpaces,
	deobfuscateLoose,
	getSuspiciousLinkReason,
	getFollowFarmReason,
	getHiddenDomains,
	getMessageDomains,
	revealLinks,
};
