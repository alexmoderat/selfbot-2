const { got } = require('../token/got.js');
/**
 * Emote-Suche nach Namen (plattformweit) ueber CommanderRoots Tool twitch-tools.rootonline.de, aus sb-v2s
 * v2/utils/emote-lookup.ts - Twitch selbst hat keine Name->Channel-Suche (alexmoderat, 29.09.2026: "es muss ja so
 * gehen wie potatbotat es macht"). Fremdes Projekt ohne Zusagen: bei jedem Fehler null statt Wurf.
 */

const SEARCH_BASE = 'https://twitch-tools.rootonline.de/api/emotes/search';
const CONTENT_ID_BASE = 'https://twitch-tools.rootonline.de/emotes_content_id.php';
const TIMEOUT_MS = 8000;

/** Erster Treffer fuer einen Emote-Namen; null = nicht gefunden oder Fehler */
const searchEmoteByName = async (name) => {
	try {
		const response = await got('Global')({
			url: `${SEARCH_BASE}/${encodeURIComponent(name)}`,
			timeout: { request: TIMEOUT_MS },
		});
		const hit = response.ok ? response.body.results?.[0] : undefined;
		return hit?.id ? { id: hit.id, token: hit.token, isAnimated: Boolean(hit.is_animated) } : null;
	} catch {
		return null;
	}
};

/** Login des Channels einer Emote-ID - das Tool leitet per 302 auf subs.twitch.tv/<channel> weiter */
const resolveEmoteChannel = async (emoteId) => {
	try {
		const response = await got('Global')({
			url: CONTENT_ID_BASE,
			searchParams: { ttv_emote: emoteId },
			followRedirect: false,
			responseType: 'text',
			timeout: { request: TIMEOUT_MS },
		});
		const location = response.headers.location;
		const match = location?.match(/subs\.twitch\.tv\/([^/?#]+)/i);
		return match ? match[1].toLowerCase() : null;
	} catch {
		return null;
	}
};

/** "Tier 1/2/3" fuer Sub-Emotes, sonst der rohe emote_type */
const formatEmoteTierLabel = (emoteType, tier) => {
	if (emoteType === 'subscriptions' && tier) {
		return `Tier ${Number(tier) / 1000}`;
	}
	return emoteType;
};

module.exports = { searchEmoteByName, resolveEmoteChannel, formatEmoteTierLabel };
