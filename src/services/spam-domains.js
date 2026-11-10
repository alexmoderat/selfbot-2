const { getMessageDomains } = require('../misc/text-analysis.js');

/**
 * Selbstlernende Spam-Domains (alexmoderat, 10.11.2026: "glaube wir muessen mal n eigenes System dafuer bauen koennen ja
 * nicht staendig neue banphrases adden"). Bannt alexmoderat jemanden von Hand und stand in dessen letzten Nachrichten ein
 * Link (auch versteckt, z. B. "d o v i e .tv"), wird die Domain gelernt; ab dann bannt banphrase-filter sie ueberall.
 * Liste im Dashboard (Admin -> Spam Domains), dort auch entfernbar.
 */

const RELOAD_INTERVAL = 60_000;
/** Nur Nachrichten so kurz vor dem Ban zaehlen - aeltere Links haben mit dem Ban vermutlich nichts zu tun */
const LEARN_WINDOW = 15 * 60_000;
const MAX_RECENT = 3;

let domains = new Set();
let reloadTimer = null;

/** Letzte Nachrichten je Channel+User im Speicher: der Chat-Logger schreibt nur einmal pro Minute in chatLines */
const recent = new Map();

const rememberMessage = (channelId, userId, text, now = Date.now()) => {
	const key = `${channelId}:${userId}`;
	const list = (recent.get(key) ?? []).filter((i) => now - i.at < LEARN_WINDOW);
	list.push({ text, at: now });
	recent.set(key, list.slice(-MAX_RECENT));
};

const pruneTimer = setInterval(() => {
	const now = Date.now();
	for (const [key, list] of recent) {
		if (now - list.at(-1).at >= LEARN_WINDOW) {
			recent.delete(key);
		}
	}
}, 60_000);
pruneTimer.unref();

const loadData = async () => {
	const rows = await bot.DB.SpamDomain.find({}, { _id: 1 }).lean();
	domains = new Set(rows.map((i) => i._id));
};

const initialize = async () => {
	await loadData();
	reloadTimer ??= setInterval(() => {
		loadData().catch((e) => console.warn('[spam-domains] Neuladen fehlgeschlagen', e));
	}, RELOAD_INTERVAL);
	reloadTimer.unref();
};

/** Gelernte Domain (auch als Subdomain, "x.dovie.tv") in einer Liste von Domains */
const matchDomains = (list, known = domains) => {
	for (const domain of list) {
		const parts = domain.split('.');
		for (let i = 0; i < parts.length - 1; i++) {
			const candidate = parts.slice(i).join('.');
			if (known.has(candidate)) {
				return candidate;
			}
		}
	}
	return null;
};

/** Gelernte Spam-Domain in der Nachricht, sonst null */
const findInMessage = (text) => (domains.size === 0 ? null : matchDomains(getMessageDomains(text)));

const recordHit = (domain) => {
	void bot.DB.SpamDomain.updateOne({ _id: domain }, { $inc: { hits: 1 }, $set: { lastHit: new Date() } }).catch(() => {});
};

/** Letzte Nachrichten des Users im Channel: Speicher, sonst chatLines (z. B. nach einem Neustart) */
const recentMessages = async (channelId, userId, now = Date.now()) => {
	const cached = (recent.get(`${channelId}:${userId}`) ?? []).filter((i) => now - i.at < LEARN_WINDOW).map((i) => i.text);
	if (cached.length > 0 || !channelId) {
		return cached;
	}

	const rows = await bot.DB.ChatLine.find({ channel: channelId, userId, posted: { $gte: new Date(now - LEARN_WINDOW) } })
		.sort({ posted: -1 })
		.limit(MAX_RECENT)
		.lean();
	return rows.map((i) => i.text);
};

/**
 * Nach einem manuellen Ban: Domains aus den letzten Nachrichten des Gebannten lernen.
 * @returns {Promise<string[]>} neu gelernte Domains
 */
const learnFromBan = async ({ channel, channelName, userId, username, modName }) => {
	if (!userId) {
		return [];
	}

	const messages = await recentMessages(channel?.id ?? null, String(userId));
	const learned = [];
	for (const text of messages) {
		for (const domain of getMessageDomains(text)) {
			if (domains.has(domain) || learned.includes(domain) || matchDomains([domain])) {
				continue;
			}

			if (await addDomain(domain, { learnedBy: modName, sourceChannel: channelName, sourceUser: username, sourceMessage: text })) {
				learned.push(domain);
			}
		}
	}

	return learned;
};

/** Domain eintragen; true = neu */
const addDomain = async (domain, { learnedBy = null, sourceChannel = null, sourceUser = null, sourceMessage = null } = {}) => {
	const result = await bot.DB.SpamDomain.updateOne(
		{ _id: domain },
		{
			$setOnInsert: {
				learnedBy,
				sourceChannel,
				sourceUser,
				sourceMessage: sourceMessage ? sourceMessage.slice(0, 500) : null,
				created: new Date(),
				hits: 0,
				lastHit: null,
			},
		},
		{ upsert: true },
	);
	domains.add(domain);
	return result.upsertedCount > 0;
};

const list = async () => await bot.DB.SpamDomain.find({}).sort({ created: -1 }).lean();

const remove = async (domain) => {
	const name = String(domain).toLowerCase().trim();
	await bot.DB.SpamDomain.deleteOne({ _id: name });
	domains.delete(name);
};

module.exports = { initialize, rememberMessage, findInMessage, recordHit, learnFromBan, addDomain, list, remove, matchDomains, LEARN_WINDOW };
