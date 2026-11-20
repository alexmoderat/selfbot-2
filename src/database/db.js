// selfbot: ERSETZT Donts db.js (mongoose, oeffnet beim Laden eine MongoDB-Verbindung). Gleiche Schnittstelle
// (bot.DB.users / channels / poroCount / private / stable / bans mit find, findOne, findOneAndUpdate, updateOne,
// create, count, `new bot.DB.x({...}).save()` und .exec()), aber auf unseren Daten:
//   users, channels -> unsere Dienste (bot.Users, bot.Channels), Dont-Level und Zusatzfelder im Dokumentenspeicher
//   poroCount, stable, private, bans -> Dokumentenspeicher "doc_store" in Donts Postgres (bot.SQL)
// Details und Grenzen: docs/dont-konzept.md, Abschnitt 3.

const { Logger, LogLevel } = require('../misc/logger');

// ---- Mongo-artige Abfragen und Updates auf einfachen Objekten ----

const getPath = (doc, path) => path.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), doc);

const OPERATORS = {
	$ne: (value, arg) => value !== arg,
	$in: (value, arg) => arg.includes(value),
	$nin: (value, arg) => !arg.includes(value),
	$gt: (value, arg) => value > arg,
	$gte: (value, arg) => value >= arg,
	$lt: (value, arg) => value < arg,
	$lte: (value, arg) => value <= arg,
	$exists: (value, arg) => (value !== undefined) === arg,
};

const isOperatorObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).some((key) => key.startsWith('$'));

const matches = (doc, query = {}) =>
	Object.entries(query).every(([path, expected]) => {
		const value = getPath(doc, path);
		if (isOperatorObject(expected)) {
			return Object.entries(expected).every(([operator, arg]) => OPERATORS[operator]?.(value, arg) ?? false);
		}
		return value === expected || (expected instanceof Date && value instanceof Date && value.getTime() === expected.getTime());
	});

const setPath = (doc, path, value) => {
	const keys = path.split('.');
	const last = keys.pop();
	const target = keys.reduce((object, key) => (object[key] = object[key] ?? {}), doc);
	target[last] = value;
};

/** $set, $inc, $push, $unset und bloße Felder (wie mongoose, das sie als $set behandelt) */
const applyUpdate = (doc, update = {}) => {
	for (const [key, value] of Object.entries(update)) {
		if (!key.startsWith('$')) {
			setPath(doc, key, value);
		} else if (key === '$set') {
			Object.entries(value).forEach(([path, v]) => setPath(doc, path, v));
		} else if (key === '$inc') {
			Object.entries(value).forEach(([path, v]) => setPath(doc, path, (getPath(doc, path) ?? 0) + v));
		} else if (key === '$push') {
			Object.entries(value).forEach(([path, v]) => setPath(doc, path, [...(getPath(doc, path) ?? []), v]));
		} else if (key === '$unset') {
			Object.keys(value).forEach((path) => setPath(doc, path, undefined));
		} else {
			throw new Error(`Update-Operator ${key} ist in der Dont-Kompatibilitaetsschicht nicht vorgesehen`);
		}
	}
	return doc;
};

// ---- Query-Objekt wie mongoose: thenable, mit .exec(), .sort(), .limit(), .lean() ----

class Query {
	#run;
	#sort = null;
	#limit = 0;

	constructor(run) {
		this.#run = run;
	}

	sort(spec) {
		this.#sort = spec;
		return this;
	}

	limit(count) {
		this.#limit = count;
		return this;
	}

	lean() {
		return this;
	}

	async exec() {
		const result = await this.#run();
		if (!Array.isArray(result)) {
			return result;
		}
		let list = result;
		if (this.#sort) {
			const entries = Object.entries(this.#sort);
			list = [...list].sort((a, b) => {
				for (const [path, direction] of entries) {
					const [x, y] = [getPath(a, path), getPath(b, path)];
					if (x !== y) {
						return (x > y ? 1 : -1) * (direction === -1 || direction === 'desc' ? -1 : 1);
					}
				}
				return 0;
			});
		}
		return this.#limit > 0 ? list.slice(0, this.#limit) : list;
	}

	then(resolve, reject) {
		return this.exec().then(resolve, reject);
	}

	catch(reject) {
		return this.exec().catch(reject);
	}
}

// ---- Modell-Fabrik ----

/**
 * @param {object} backend list(): alle Dokumente (Objekte), insert(doc), update(doc, changes), (optional) remove(doc)
 */
const createModel = (name, backend) => {
	const decorate = (data, isNew) => {
		const doc = { ...data };
		// Aenderungen, die Handler direkt am Dokument machen, schreibt save() zurueck
		Object.defineProperty(doc, 'save', {
			enumerable: false,
			value: async () => {
				const { save, ...plain } = Object.fromEntries(Object.entries(doc));
				void save;
				if (isNew && !doc._persisted) {
					await backend.insert(plain);
					Object.defineProperty(doc, '_persisted', { enumerable: false, value: true });
				} else {
					await backend.update(plain, plain);
				}
				return doc;
			},
		});
		Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => ({ ...doc }) });
		return doc;
	};

	class Model {
		constructor(data) {
			return decorate(data, true);
		}

		static find(query) {
			return new Query(async () => (await backend.list(query)).filter((doc) => matches(doc, query)).map((doc) => decorate(doc, false)));
		}

		static findOne(query) {
			return new Query(async () => {
				const doc = (await backend.list(query)).find((item) => matches(item, query));
				return doc ? decorate(doc, false) : null;
			});
		}

		static count(query) {
			return new Query(async () => (await backend.list(query)).filter((doc) => matches(doc, query)).length);
		}

		static countDocuments(query) {
			return Model.count(query);
		}

		static create(data) {
			return new Query(async () => {
				const doc = decorate(data, true);
				await doc.save();
				return doc;
			});
		}

		static updateOne(query, update) {
			return new Query(async () => {
				const doc = (await backend.list(query)).find((item) => matches(item, query));
				if (!doc) {
					return { matchedCount: 0, modifiedCount: 0 };
				}
				await backend.update(doc, applyUpdate({ ...doc }, update));
				return { matchedCount: 1, modifiedCount: 1 };
			});
		}

		/** Mit { new: true } das aktualisierte, sonst das alte Dokument (wie mongoose) */
		static findOneAndUpdate(query, update, options = {}) {
			return new Query(async () => {
				const doc = (await backend.list(query)).find((item) => matches(item, query));
				if (!doc) {
					return null;
				}
				const updated = applyUpdate({ ...doc }, update);
				await backend.update(doc, updated);
				return decorate(options.new ? updated : doc, false);
			});
		}

		static deleteOne(query) {
			return new Query(async () => {
				const doc = (await backend.list(query)).find((item) => matches(item, query));
				if (doc && backend.remove) {
					await backend.remove(doc);
				}
				return { deletedCount: doc ? 1 : 0 };
			});
		}
	}

	Object.defineProperty(Model, 'modelName', { value: name });
	return Model;
};

// ---- Dokumentenspeicher in Donts Postgres (bot.SQL) ----

const createPgStore = (getSql = () => bot.SQL) => {
	let ready = null;
	const init = () => (ready ??= getSql().query('CREATE TABLE IF NOT EXISTS doc_store (collection VARCHAR(64) NOT NULL, key VARCHAR(255) NOT NULL, doc JSONB NOT NULL, PRIMARY KEY (collection, key))'));
	return {
		async list(collection) {
			await init();
			const { rows } = await getSql().query('SELECT doc FROM doc_store WHERE collection = $1', [collection]);
			return rows.map((row) => revive(row.doc));
		},
		async put(collection, key, doc) {
			await init();
			await getSql().query('INSERT INTO doc_store (collection, key, doc) VALUES ($1, $2, $3) ON CONFLICT (collection, key) DO UPDATE SET doc = EXCLUDED.doc', [collection, String(key), JSON.stringify(doc)]);
		},
		async remove(collection, key) {
			await init();
			await getSql().query('DELETE FROM doc_store WHERE collection = $1 AND key = $2', [collection, String(key)]);
		},
	};
};

/** Datumsfelder, die als ISO-Text im JSON liegen, wieder zu Date */
const revive = (doc) => {
	for (const [key, value] of Object.entries(doc)) {
		if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)) {
			doc[key] = new Date(value);
		}
	}
	return doc;
};

let nextKey = 0;
const keyOf = (doc) => doc.id ?? doc.code ?? `${Date.now()}-${nextKey++}`;

const storeBackend = (store, collection) => ({
	list: () => store.list(collection),
	async insert(doc) {
		doc.id ??= keyOf(doc);
		await store.put(collection, keyOf(doc), doc);
	},
	update: (previous, doc) => store.put(collection, keyOf(previous), doc),
	remove: (doc) => store.remove(collection, keyOf(doc)),
});

// ---- users: Sicht auf unsere User plus Dont-Level ----

const ready = async () => {
	await bot.Ready;
};

const DEFAULT_LEVEL = 1;
const ADMIN_LEVEL = 3;

/** Dont-Level: explizit gesetzt (setlevel, Bann in einem Channel), sonst Bot-Administrator = 3, alle anderen 1 */
const userBackend = (store) => {
	const toDoc = (user, override) => ({
		id: user.twitchId,
		username: user.name,
		firstSeen: user.startedUsing ?? new Date(0),
		level: override?.level ?? (bot.Users.isAdministrator(user) ? ADMIN_LEVEL : DEFAULT_LEVEL),
	});

	return {
		async list(query = {}) {
			await ready();
			const overrides = await store.list('userLevel');
			const byId = new Map(overrides.map((item) => [item.id, item]));
			const docs = [];
			// Einzelabfrage: den User laden (der Handler fragt je Nachricht genau einen)
			const user = query.id ? await bot.Users.getByTwitchId(query.id) : query.username ? await bot.Users.get(query.username) : null;
			if (user?.twitchId) {
				docs.push(toDoc(user, byId.get(user.twitchId)));
			}
			// Sammelabfrage (find({ level: 0 }) beim Joinen): die gesetzten Overrides
			if (!query.id && !query.username) {
				for (const override of overrides) {
					docs.push({ id: override.id, username: override.username ?? null, firstSeen: new Date(0), level: override.level });
				}
			}
			return docs;
		},
		async insert(doc) {
			await ready();
			await bot.Users.getOrCreate(doc.username, { twitchId: doc.id });
			if (doc.level !== undefined && doc.level !== DEFAULT_LEVEL) {
				await store.put('userLevel', doc.id, { id: doc.id, username: doc.username, level: doc.level });
			}
		},
		async update(previous, doc) {
			if (doc.level !== undefined && doc.level !== previous.level) {
				await store.put('userLevel', previous.id, { id: previous.id, username: doc.username ?? previous.username, level: doc.level });
			}
			// Namensaenderungen traegt unser User-Dienst selbst nach (Users.getOrCreate bei der naechsten Nachricht)
		},
	};
};

// ---- channels: Sicht auf bot.Channels plus Dont-Zusatzfelder ----

const channelBackend = (store, isServed) => {
	const toDoc = (channel, extra) => ({
		id: channel.twitchId,
		username: channel.name,
		joinedAt: channel.added,
		prefix: bot.Channels.getData(channel, 'prefix') ?? bot.Config.prefix,
		isChannel: channel.mode !== 'Inactive',
		offlineOnly: extra?.offlineOnly ?? false,
		editors: extra?.editors ?? [],
		addedBy: extra?.addedBy ?? [],
		optionalSettings: extra?.optionalSettings ?? {},
	});

	return {
		async list() {
			await ready();
			const extras = new Map((await store.list('channelExtra')).map((item) => [item.id, item]));
			return bot.Channels.all()
				.filter((channel) => channel.twitchId && isServed(channel.name))
				.map((channel) => toDoc(channel, extras.get(channel.twitchId)));
		},
		async insert(doc) {
			await ready();
			if (!bot.Channels.getByTwitchId(doc.id)) {
				await bot.Channels.add(doc.username, 'Write', doc.id);
			}
			await this.update({ id: doc.id }, doc);
		},
		async update(previous, doc) {
			const channel = bot.Channels.getByTwitchId(previous.id);
			if (!channel) {
				return;
			}
			if (doc.prefix !== undefined && doc.prefix !== previous.prefix) {
				await bot.Channels.setData(channel, 'prefix', doc.prefix);
			}
			if (doc.isChannel === false && channel.mode !== 'Inactive') {
				await bot.Channels.saveProperty(channel, 'Mode', 'Inactive');
			} else if (doc.isChannel === true && channel.mode === 'Inactive') {
				await bot.Channels.saveProperty(channel, 'Mode', 'Write');
			}
			const { offlineOnly, editors, addedBy, optionalSettings } = doc;
			await store.put('channelExtra', previous.id, { id: previous.id, offlineOnly, editors, addedBy, optionalSettings });
		},
	};
};

// ---- Zusammenbau ----

/** Fuer Tests mit eigenem Speicher/isServed: createCompat({ store, isServed }) */
const createCompat = ({ store = createPgStore(), isServed = (name) => require('../selfbot/clients/JoinChannels.js').isServed(name) } = {}) => ({
	users: createModel('users', userBackend(store)),
	channels: createModel('channels', channelBackend(store, isServed)),
	poroCount: createModel('poroCount', storeBackend(store, 'poroCount')),
	private: createModel('private', storeBackend(store, 'private')),
	stable: createModel('stable', storeBackend(store, 'stable')),
	bans: createModel('bans', storeBackend(store, 'bans')),
});

const compat = createCompat();

exports.users = compat.users;
exports.poroCount = compat.poroCount;
exports.channels = compat.channels;
exports.private = compat.private;
exports.stable = compat.stable;
exports.bans = compat.bans;

/** Wie bei Dont: Namen in einer Collection nachtragen */
exports.updateUser = async (Collection, newName, userID) => {
	if (!userID || !newName) return { error: 'No user ID provided' };
	if (typeof userID !== 'string' || typeof newName !== 'string') return { error: 'User ID must be a string' };
	const user = await exports[Collection].findOne({ id: userID }).exec();
	if (!user) return { error: 'User not found' };
	const updatedUser = await exports[Collection].findOneAndUpdate({ id: userID }, { $set: { username: newName } }, { new: true }).exec();

	return {
		user: updatedUser,
		success: true,
	};
};

Logger.log(LogLevel.DEBUG, 'Dont-Kompatibilitaetsschicht (bot.DB.users/channels/...) geladen');

exports.createCompat = createCompat;
exports.matches = matches;
exports.applyUpdate = applyUpdate;
