const dataProperties = require('./data-properties.js');

// User (bisher classes/user.ts): ein Datensatz pro Person, beim ersten Auftauchen im Chat angelegt.
// Namensaenderungen werden ueber die Twitch-ID erkannt. Ein User ist { id, name, twitchId, startedUsing, data }.

const cache = new Map(); // Name -> User
const pending = new Map();

const fromDoc = (doc) => ({ id: doc._id, name: doc.name, twitchId: doc.twitchId ?? null, startedUsing: doc.startedUsing, data: doc.data ?? {} });

const normalizeUsername = (name) => String(name).toLowerCase().replace(/^@/, '').replace(/,$/, '').trim();

const store = (doc) => {
	const user = fromDoc(doc);
	cache.set(user.name, user);
	return user;
};

/** Bekannter User per Name oder ID, ohne ihn anzulegen */
const get = async (identifier) => {
	if (identifier && typeof identifier === 'object') {
		return identifier;
	} else if (typeof identifier === 'number') {
		for (const user of cache.values()) {
			if (user.id === identifier) {
				return user;
			}
		}
		const doc = await bot.DB.User.findById(identifier).lean();
		return doc ? store(doc) : null;
	}

	const name = normalizeUsername(identifier);
	const cached = cache.get(name);
	if (cached) {
		return cached;
	}
	const doc = await bot.DB.User.findOne({ name }).lean();
	return doc ? store(doc) : null;
};

const getByTwitchId = async (twitchId) => {
	for (const user of cache.values()) {
		if (user.twitchId === twitchId) {
			return user;
		}
	}
	const doc = await bot.DB.User.findOne({ twitchId }).lean();
	return doc ? store(doc) : null;
};

const create = async (name, twitchId) => {
	const doc = await bot.DB.User.create({ _id: await bot.DB.nextId('users'), name, twitchId: twitchId ?? null });
	return store(doc.toObject());
};

const findOrCreate = async (name, options) => {
	const existing = await get(name);
	if (existing) {
		if (options.twitchId && existing.twitchId !== options.twitchId) {
			// Name gehoert jetzt einem anderen Konto: alte ID gibt den Namen frei? Wie bisher: Twitch-ID nachziehen
			await bot.DB.User.updateOne({ _id: existing.id }, { $set: { twitchId: options.twitchId } });
			existing.twitchId = options.twitchId;
		}
		return existing;
	}

	if (options.twitchId) {
		// Gleiche Twitch-ID unter altem Namen -> umbenannt, Datensatz uebernehmen
		const renamed = await bot.DB.User.findOne({ twitchId: options.twitchId }).lean();
		if (renamed) {
			cache.delete(renamed.name);
			await bot.DB.User.updateOne({ _id: renamed._id }, { $set: { name } });
			return store({ ...renamed, name });
		}
	}

	return await create(name, options.twitchId);
};

/** Holt oder legt einen User an - fuer jeden, der im Chat schreibt */
const getOrCreate = async (name, options = {}) => {
	const normalized = normalizeUsername(name);
	const running = pending.get(normalized);
	if (running) {
		return await running;
	}
	const promise = findOrCreate(normalized, options).finally(() => pending.delete(normalized));
	pending.set(normalized, promise);
	return await promise;
};

const getData = (user, property) => dataProperties.read(dataProperties.userDataSchema, 'user', user, property);
const setData = (user, property, value) => dataProperties.write(dataProperties.userDataSchema, 'user', bot.DB.User, user, property, value);

const isAdministrator = (user) => getData(user, 'administrator') === true;

module.exports = { get, getByTwitchId, getOrCreate, getData, setData, isAdministrator, normalizeUsername, fromDoc, cache };
