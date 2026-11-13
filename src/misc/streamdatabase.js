const { got } = require('../token/got.js');

/**
 * Globale Twitch-Badges von streamdatabase.com (ninou2, 13.11.2026: "whenever a new badge/emote get added, post about
 * it [in] the chat", Quelle https://www.streamdatabase.com/twitch/global-badges; alexmoderat: die Twitch-API ist ihm
 * dafuer zu unzuverlaessig). Die Seite liefert die Liste serverseitig im __NEXT_DATA__-Block, kein API-Schluessel noetig.
 */
const BADGES_URL = 'https://www.streamdatabase.com/twitch/global-badges';
const NEXT_DATA = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;

/** HTML der Seite -> [{ key, title, description, addedAt }], entfernte Badges ausgelassen */
const parseBadges = (html) => {
	const match = NEXT_DATA.exec(String(html));
	if (!match) {
		throw new Error('__NEXT_DATA__ nicht gefunden');
	}

	const list = JSON.parse(match[1])?.props?.pageProps?.initialTwitchGlobalBadges;
	if (!Array.isArray(list)) {
		throw new Error('Badge-Liste fehlt');
	}

	return list
		.filter((i) => i?.current?.set_id && i.current.version?.id !== undefined && !i.removed)
		.map((i) => ({
			key: `${i.current.set_id}:${i.current.version.id}`,
			title: String(i.current.version.title ?? i.current.set_id),
			description: String(i.current.version.description ?? ''),
			addedAt: i.added_at ?? i.added ?? null,
		}));
};

const fetchGlobalBadges = async () => {
	const response = await got('Global')({
		url: BADGES_URL,
		headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
		responseType: 'text',
		timeout: { request: 30_000 },
	});
	if (!response.ok) {
		throw new Error(`streamdatabase: HTTP ${response.statusCode}`);
	}

	return parseBadges(response.body);
};

module.exports = { BADGES_URL, parseBadges, fetchGlobalBadges };
