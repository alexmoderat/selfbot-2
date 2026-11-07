// Globale Beobachtungsliste (Tabelle Watch_Alert), aus sb-v2s v2/singletons/watch-alerts.ts: Accounts, bei denen der
// Bot jede Nachricht in einem seiner Channels im Mod-Log meldet (Modul watched-user-notice). Getrennt von der
// Pro-Channel-Watchlist (!watchlist), die nur ein Merkzettel ist. Zuordnung ueber die User-ID (ueberlebt
// Umbenennungen), sonst ueber den Login. Alle 30 s nachladen, falls jemand direkt in der DB eintraegt.

let byId = new Map();
let byLogin = new Map();
let ready = null;
let timer = null;

const load = async () => {
	const rows = await bot.DB.WatchAlert.find({}).sort({ added: 1 }).lean();
	const entries = rows.map((i) => ({ login: i.login, userId: i.userId, reason: i.reason, addedBy: i.addedBy }));
	byId = new Map(entries.filter((i) => i.userId).map((i) => [i.userId, i]));
	byLogin = new Map(entries.map((i) => [i.login, i]));
};

const init = () => {
	ready ??= (async () => {
		await load();
		timer = setInterval(() => void load().catch(() => {}), 30_000);
		timer.unref();
	})().catch((e) => {
		ready = null;
		throw e;
	});

	return ready;
};

/** Eintrag zu einer Nachricht (ID hat Vorrang vor dem Login) */
const find = (userId, login) => (userId ? byId.get(userId) : undefined) ?? byLogin.get(login.toLowerCase());

const add = async (loginRaw, userId, reason, addedBy) => {
	await init();
	const login = loginRaw.toLowerCase();
	await bot.DB.WatchAlert.updateOne({ login }, { $set: { userId, reason, addedBy }, $setOnInsert: { added: new Date() } }, { upsert: true });
	await load();
	return byLogin.get(login);
};

/** Entfernt per Login oder User-ID; true, wenn es einen Eintrag gab */
const remove = async (loginOrId) => {
	await init();
	const key = loginOrId.toLowerCase();
	const existed = Boolean(byLogin.get(key) ?? byId.get(key));
	await bot.DB.WatchAlert.deleteMany({ $or: [{ login: key }, { userId: key }] });

	await load();
	return existed;
};

const list = async () => {
	await init();
	return [...byLogin.values()];
};

/** Nur fuer Tests */
const _reset = () => {
	byId = new Map();
	byLogin = new Map();
	ready = null;
	if (timer) {
		clearInterval(timer);
	}
	timer = null;
};

module.exports = { init, find, add, remove, list, _reset };
