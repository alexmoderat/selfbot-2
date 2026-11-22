/**
 * Verlauf der gemeldeten globalen Badges/Emotes in Redis (ninou2, 13.11.2026: "a way to trigger the bot to post the last 1
 * info he got from database ... up to 5"). Neueste zuerst, hoechstens KEEP Eintraege je Art.
 */
const KEEP = 20;
const TTL = 365 * 864e5;
const keyOf = (kind) => `badge-watch:recent:${kind}`;

/** entries: [{ title, description?, how?, until? }] -> vorne einsortieren (die zuletzt genannte ist die neueste) */
const recordRecent = async (kind, entries, at = new Date().toISOString()) => {
	if (entries.length === 0) {
		return;
	}

	const stored = (await bot.Cache.getJSON(keyOf(kind)).catch(() => null)) ?? [];
	const added = entries.map((i) => ({ ...i, at })).reverse();
	await bot.Cache.setJSON(keyOf(kind), [...added, ...(Array.isArray(stored) ? stored : [])].slice(0, KEEP), TTL);
};

const getRecent = async (kind, count) => {
	const stored = await bot.Cache.getJSON(keyOf(kind)).catch(() => null);
	return (Array.isArray(stored) ? stored : []).slice(0, count);
};

/**
 * Schon gemeldete Eintraege ("added:badge:silver chain"), damit Tweet und Seite dasselbe Badge nicht doppelt melden:
 * wer zuerst kommt (meist der Tweet), meldet, der andere bleibt still.
 */
const ANNOUNCED_KEY = 'badge-watch:announced';
const ANNOUNCED_KEEP = 300;
const ANNOUNCED_TTL = 3 * 864e5;

const wasAnnounced = async (key) => {
	const stored = await bot.Cache.getJSON(ANNOUNCED_KEY).catch(() => null);
	return Array.isArray(stored) && stored.includes(key);
};

const markAnnounced = async (key) => {
	const stored = await bot.Cache.getJSON(ANNOUNCED_KEY).catch(() => null);
	const list = Array.isArray(stored) ? stored : [];
	if (!list.includes(key)) {
		await bot.Cache.setJSON(ANNOUNCED_KEY, [...list, key].slice(-ANNOUNCED_KEEP), ANNOUNCED_TTL);
	}
};

module.exports = { recordRecent, getRecent, wasAnnounced, markAnnounced, KEEP };
