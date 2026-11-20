const { getMessageDomains } = require('./text-analysis.js');

/**
 * Spam-Domains aus versteckten Links (alexmoderat, 10.11.2026: "glaube wir muessen mal n eigenes System dafuer bauen
 * koennen ja nicht staendig neue banphrases adden"). Bannt banphrase-filter einen versteckten Link ("d o v i e .tv"),
 * landet die Domain hier, damit sie auch offen geschrieben ("dovie.tv") greift. Kein Lernen aus manuellen Bans mehr
 * (alexmoderat: "das mit lernen halt ich fuer naja"). Liste im Dashboard (Admin -> Spam Domains), dort entfernbar.
 */

const RELOAD_INTERVAL = 60_000;

let domains = new Set();
let reloadTimer = null;

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

/** Bekannte Domain (auch als Subdomain, "x.dovie.tv") in einer Liste von Domains */
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

/** Bekannte Spam-Domain in der Nachricht, sonst null */
const findInMessage = (text) => (domains.size === 0 ? null : matchDomains(getMessageDomains(text)));

const recordHit = (domain) => {
	void bot.DB.SpamDomain.updateOne({ _id: domain }, { $inc: { hits: 1 }, $set: { lastHit: new Date() } }).catch(() => {});
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

module.exports = { initialize, findInMessage, recordHit, addDomain, list, remove, matchDomains };
