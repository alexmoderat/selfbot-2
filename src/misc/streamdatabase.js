const { got } = require('../token/got.js');

/**
 * Globale Twitch-Badges von streamdatabase.com (ninou2, 13.11.2026: "whenever a new badge/emote get added, post about
 * it [in] the chat", Quelle https://www.streamdatabase.com/twitch/global-badges; alexmoderat: die Twitch-API ist ihm
 * dafuer zu unzuverlaessig). Die Seite liefert die Liste serverseitig im __NEXT_DATA__-Block, kein API-Schluessel noetig.
 */
const BADGES_URL = 'https://www.streamdatabase.com/twitch/global-badges';
const EMOTES_URL = 'https://www.streamdatabase.com/twitch/global-emotes';
const EVENTS_URL = 'https://api.streamdatabase.com/events';
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

/** HTML der Emote-Seite -> [{ key, title }] (Emote-ID und Name) */
const parseEmotes = (html) => {
	const match = NEXT_DATA.exec(String(html));
	if (!match) {
		throw new Error('__NEXT_DATA__ nicht gefunden');
	}

	const list = JSON.parse(match[1])?.props?.pageProps?.twitchGlobalEmotes;
	if (!Array.isArray(list)) {
		throw new Error('Emote-Liste fehlt');
	}

	return list.filter((i) => i?.current?.id && i.current.name && !i.removed).map((i) => ({ key: String(i.current.id), title: String(i.current.name) }));
};

const fetchPage = async (url) => {
	const response = await got('Global')({
		url,
		headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
		responseType: 'text',
		timeout: { request: 30_000 },
	});
	if (!response.ok) {
		throw new Error(`streamdatabase: HTTP ${response.statusCode}`);
	}

	return response.body;
};

const fetchGlobalBadges = async () => parseBadges(await fetchPage(BADGES_URL));
const fetchGlobalEmotes = async () => parseEmotes(await fetchPage(EMOTES_URL));

/**
 * Aktionen (api.streamdatabase.com/events, ohne Schluessel): je Badge "wie bekommt man es, bis wann" (alexmoderat,
 * 13.11.2026: "ja" zu den Angaben aus den Aktionen). -> Map "set_id:version" -> { how, until }
 */
const requirementOf = (availability) => {
	const parts = [];
	if (availability?.watch) {
		parts.push(availability.watch_minutes ? `watch ${availability.watch_minutes} min` : 'watch');
	}
	if (availability?.subscription) {
		parts.push('sub');
	}
	if (availability?.subscription_gift) {
		parts.push('gift a sub');
	}
	if (availability?.bits) {
		parts.push('cheer bits');
	}
	if (availability?.twitchcon) {
		parts.push('TwitchCon ticket');
	}

	return parts.join(' / ');
};

const parseEvents = (json) => {
	const result = new Map();
	for (const event of json?.data ?? []) {
		for (const badge of event?.twitch_global_badges ?? []) {
			const key = badge?.current?.set_id ? `${badge.current.set_id}:${badge.current.version?.id}` : null;
			const availability = badge?.availability?.[0];
			if (key && availability) {
				result.set(key, { how: requirementOf(availability), until: availability.end_at_date ?? event.end_at_date ?? null, event: event.title ?? null });
			}
		}
	}

	return result;
};

const fetchBadgeEvents = async () => {
	const response = await got('Global')({
		url: EVENTS_URL,
		headers: { 'User-Agent': 'selfbot-badge-watch' },
		responseType: 'json',
		timeout: { request: 20_000 },
	});
	if (!response.ok) {
		throw new Error(`streamdatabase events: HTTP ${response.statusCode}`);
	}

	return parseEvents(response.body);
};

module.exports = {
	BADGES_URL,
	EMOTES_URL,
	EVENTS_URL,
	parseBadges,
	parseEmotes,
	parseEvents,
	requirementOf,
	fetchGlobalBadges,
	fetchGlobalEmotes,
	fetchBadgeEvents,
};
