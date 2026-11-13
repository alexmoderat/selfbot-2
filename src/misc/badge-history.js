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

	const stored = (await bot.Redis.getJSON(keyOf(kind)).catch(() => null)) ?? [];
	const added = entries.map((i) => ({ ...i, at })).reverse();
	await bot.Redis.setJSON(keyOf(kind), [...added, ...(Array.isArray(stored) ? stored : [])].slice(0, KEEP), TTL);
};

const getRecent = async (kind, count) => {
	const stored = await bot.Redis.getJSON(keyOf(kind)).catch(() => null);
	return (Array.isArray(stored) ? stored : []).slice(0, count);
};

module.exports = { recordRecent, getRecent, KEEP };
