const { isKnownBot } = require('./channel-stats.js');
const { fetchChannelRoleList } = require('../misc/roles-tv.js');

/**
 * "In wie vielen unserer Channels ist wer Mod" (ninou2, 19.08.2026), aus sb-v2s singletons/mod-leaderboard.ts.
 * Mods von roles.tv, alle 6 h neu aufgebaut (crons/mod-leaderboard). sb-v2 nahm die anonyme GQL-Abfrage
 * UserRolesCacheQuery - die antwortet seit Oktober 2026 "unauthenticated", sb-v2s Liste war am 23.10.2026 leer. sb-v2 hielt den Stand in
 * data/mod-leaderboard.json, damit er einen Neustart uebersteht - hier im Redis-Cache.
 */

const CACHE_KEY = 'mod-leaderboard';
const CHANNEL_DELAY_MS = 250;
const PER_CHANNEL_TIMEOUT_MS = 10_000;

// Grosse Moderations-/Utility-Bots ("famous bots", ninou2) und die eigene Alt-Account-Familie
const FAMOUS_BOTS = new Set([
	'streamelements',
	'nightbot',
	'fossabot',
	'moobot',
	'wizebot',
	'coebot',
	'ankhbot',
	'deepbot',
	'phantombot',
	'commanderroot',
	'stay_hydrated_bot',
	'own3d',
	'sery_bot',
	'susgeebot',
	'potatbotat',
	'restreambot',
	'soundalerts',
]);
const OWN_ACCOUNT_PATTERN = /^alex(mod(erat)?|_mod|_notifybot|_sbottats)/i;

let state = { entries: [], builtAt: null };
let loaded = false;
let building = false;

const withTimeout = (promise, ms) =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timeout nach ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(e) => {
				clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});

/** Zaehlung ohne Netz: Mod-Listen je Channel -> Top 25, ohne eigenen Account, Bots und Alt-Accounts */
const rankModerators = async (modLists, ownLogin, isBot) => {
	const counts = new Map();
	for (const mods of modLists) {
		for (const raw of mods) {
			const login = raw.toLowerCase();
			if (login === ownLogin || FAMOUS_BOTS.has(login) || OWN_ACCOUNT_PATTERN.test(login) || (await isBot(login))) {
				continue;
			}
			counts.set(login, (counts.get(login) ?? 0) + 1);
		}
	}

	return [...counts.entries()]
		.map(([login, count]) => ({ login, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 25);
};

const refresh = async (channels, ownLogin) => {
	if (building) {
		return;
	}

	building = true;
	try {
		const modLists = [];
		let failed = 0;
		for (const [i, channel] of channels.entries()) {
			if (i === 0 || (i + 1) % 10 === 0) {
				console.log(`[mod-leaderboard] (${i + 1}/${channels.length}) ${channel} ...`);
			}
			try {
				const mods = await withTimeout(fetchChannelRoleList(channel, 'moderators'), PER_CHANNEL_TIMEOUT_MS * 3);
				if (mods) {
					modLists.push(mods.entries.map((m) => m.login));
				}
			} catch (e) {
				failed++;
				console.warn(`[mod-leaderboard] Fehler in ${channel}: ${e instanceof Error ? e.message : String(e)}`);
			}
			await new Promise((resolve) => setTimeout(resolve, CHANNEL_DELAY_MS));
		}

		state = { entries: await rankModerators(modLists, ownLogin.toLowerCase(), isKnownBot), builtAt: Date.now() };
		loaded = true;
		await bot.Redis.setJSON(CACHE_KEY, state);
		console.log(`[mod-leaderboard] Neu aufgebaut - ${state.entries.length} Eintraege, ${failed} Channel(s) uebersprungen`);
	} finally {
		building = false;
	}
};

const getTop = async (limit = 10) => {
	if (!loaded) {
		loaded = true;
		const cached = await bot.Redis.getJSON(CACHE_KEY).catch(() => null);
		if (cached && Array.isArray(cached.entries)) {
			state = cached;
		}
	}
	return { entries: state.entries.slice(0, limit), builtAt: state.builtAt };
};

module.exports = { FAMOUS_BOTS, OWN_ACCOUNT_PATTERN, rankModerators, refresh, getTop };
