const { DOMAIN_REGEX } = require('./text-analysis.js');

/**
 * Gemeinsame Regeln fuer die CatQuery-Muster (Discord-Austausch mit dessen Entwickler, 24.08.2026), aus sb-v2s
 * v2/utils/network-bot-rules.ts: first-message-bot, viewbot-seller-bot, discord-scammer-bot, social-media-scammer-bot.
 * Alle teilen dieselbe Grundlogik (Erstnachricht + keine Badges + gleicher Text in N Channels binnen 10 min)
 * und unterscheiden sich nur in Muster und Schwellenwerten.
 */

// Gleiche Domain-Erkennung wie der normale Link-Spam-Filter - "common viewbot URLs" laut CatQuery
const VIEWBOT_URL_PATTERN = DOMAIN_REGEX;

// Deckungsgleich mit der globalen "discord invite spam"-Banphrase-Regex aus sb-v2 (ban_phrases, id 39/91).
// Ergaenzungen: @ statt a + 0 statt o (jordyn_tylex, 31.08.2026), "let's hang out on discord" (vibezonic234),
// [.\s]* statt [.\s]? + "discord - username" ("dis  cord", nexusdojo4rl), "my discord username is X" (30.08.2026),
// "mine's X if you wanna add me" (djfjejfaqw in #iyric__, 13.10.2026 - umgekehrte Reihenfolge).
const DISCORD_SCAM_PATTERN =
	/([@a]dd (me|him|us)|let'?s connect|you can add me|hit me\b.*|(let'?s )?chill about it|talk about it|(let'?s )?hang out) (up )?on (my |your )?d[.\s]*[i1][.\s]*s[.\s]*c[.\s]*[o0][.\s]*r[.\s]*d|my d[.\s]*[i1][.\s]*s[.\s]*c[.\s]*[o0][.\s]*r[.\s]*d (username|name|id|tag)?\s*is|d[.\s]*[i1][.\s]*s[.\s]*c[.\s]*[o0][.\s]*r[.\s]*d\s*[-:]\s*\S+|mine'?s\s+\S+\s+if\s+(you\s+)?wanna\s+add\s+me/i;

// Dieselbe Masche auf anderen Plattformen - Vorfall dave567re in itmustbekhii, 31.08.2026:
// "... Add me on Snapchat Eny1233 I got tips" - alexmoderat: "Eigene Kategorie".
const SOCIAL_SCAM_PATTERN = /(add me|hit me up|message me|dm me|reach out to me)\s*(up)?\s*on\s*(my |your )?(snap(chat)?|telegram|insta(gram)?|kik|whats\s?app)\b/i;

const WINDOW = 10 * 60 * 1000;
const NEW_ACCOUNT_MAX_AGE = 2 * 24 * 60 * 60 * 1000;
// CatQuery, 24.08.2026: Nachrichten binnen 5 s nach der vorherigen zaehlen nicht (Shared-Chat-Duplikate)
const MIN_GAP = 5 * 1000;

// requireNoColor entfiel schon in sb-v2 (31.08.2026): moderne Bot-Netze setzen zufaellige Farben, um genau
// diesen Filter zu umgehen - die Cross-Channel-Schwelle allein ist ein starkes genug Signal.
const RULES = [
	{ category: 'fm', pattern: null, minChannelsDefault: 10, minChannelsNewAccount: 8, reasonLabel: 'Repeated First Message Bot' },
	{ category: 'vb', pattern: VIEWBOT_URL_PATTERN, minChannelsDefault: 3, minChannelsNewAccount: 2, reasonLabel: 'Repeated Viewbot Seller' },
	{ category: 'dc', pattern: DISCORD_SCAM_PATTERN, minChannelsDefault: 3, minChannelsNewAccount: 2, reasonLabel: 'Repeated Discord Scammer' },
	{ category: 'sm', pattern: SOCIAL_SCAM_PATTERN, minChannelsDefault: 3, minChannelsNewAccount: 2, reasonLabel: 'Repeated Social Media Scammer' },
];

const getRule = (category) => RULES.find((i) => i.category === category);

// Ansprache ueber zwei Nachrichten gesplittet ("Add me up on" / "discord @xyz") - mary0as in ninou2, 31.08.2026
const COMBINE_CATEGORIES = new Set(['dc', 'sm']);
const COMBINE_WINDOW = 20 * 1000;

/**
 * "streamerbeat com" (Leerzeichen statt Punkt) lief an DOMAIN_REGEX vorbei (30.08.2026), "twitchmax .com" ist die
 * zweite Variante. Bewusst nur eindeutige TLDs (kurze ccTLDs wie "es"/"im" kollidieren mit normalen Woertern).
 */
const UNAMBIGUOUS_TLDS = new Set(['com', 'net', 'org', 'ru', 'xyz']);
const collapseUnambiguousTlds = (message) => message.toLowerCase().replace(/([a-z0-9-])\s+\.?\s*([a-z]{2,})\b/g, (match, a, b) => (UNAMBIGUOUS_TLDS.has(b) ? `${a}.${b}` : match));

module.exports = {
	VIEWBOT_URL_PATTERN,
	DISCORD_SCAM_PATTERN,
	SOCIAL_SCAM_PATTERN,
	WINDOW,
	NEW_ACCOUNT_MAX_AGE,
	MIN_GAP,
	RULES,
	getRule,
	COMBINE_CATEGORIES,
	COMBINE_WINDOW,
	collapseUnambiguousTlds,
};
