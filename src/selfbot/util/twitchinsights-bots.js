const { got } = require('../token/got.js');
// TwitchInsights-Botliste fuer !botcheck/!botban, aus sb-v2s src/services/twitchinsights-bots.js.
// Alle 6 h neu laden; Redis haelt die letzte Liste ueber Neustarts (sb-v2: data/twitchinsights-bots.json).

const API_URL = 'https://api.twitchinsights.net/v1/bots/all';
const CACHE_KEY = 'selfbot-twitchinsights-bots';
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

let bots = new Set();
let timer = null;

const refresh = async () => {
	const response = await got('Global')({
		url: API_URL,
		timeout: { request: 15_000 },
	}).catch(() => null);

	const list = response?.ok && Array.isArray(response.body.bots) ? response.body.bots.map((i) => String(i[0] ?? '').toLowerCase()).filter(Boolean) : null;

	if (!list) {
		console.warn(`[twitchinsights] Botliste nicht ladbar (${response?.statusCode ?? '?'})`);
		return;
	}

	bots = new Set(list);
	await bot.Cache.setJSON(CACHE_KEY, list);
	console.log(`[twitchinsights] Botliste: ${list.length} Eintraege`);
};

/** Liste laden (Redis sofort, frisch im Hintergrund) und den 6-h-Takt starten */
const initialize = async () => {
	const cached = await bot.Cache.getJSON(CACHE_KEY);
	if (Array.isArray(cached)) {
		bots = new Set(cached);
	}

	void refresh();
	timer ??= setInterval(() => void refresh(), REFRESH_INTERVAL);
	timer.unref();
};

const isListedBot = (login) => bots.has(login.toLowerCase());
const getBotCount = () => bots.size;

module.exports = { initialize, isListedBot, getBotCount };
