const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createCompat, matches, applyUpdate } = require('../src/database/db.js');

// Donts Aufrufe (handler.js, JoinChannels.js, events/*) gegen die Kompatibilitaetsschicht, mit Speicher im RAM
// und Attrappen fuer bot.Users / bot.Channels

const memoryStore = () => {
	const data = new Map();
	return {
		async list(collection) {
			return [...(data.get(collection)?.values() ?? [])].map((doc) => structuredClone(doc));
		},
		async put(collection, key, doc) {
			data.set(collection, (data.get(collection) ?? new Map()).set(key, structuredClone(doc)));
		},
		async remove(collection, key) {
			data.get(collection)?.delete(key);
		},
	};
};

let db;
let channels;
let users;
let saved;

beforeEach(() => {
	saved = [];
	users = [{ id: 1, name: 'alice', twitchId: '10', startedUsing: new Date(1000), data: {} }];
	channels = [
		{ id: 1, name: 'testaccountalexmoderat', twitchId: '20', mode: 'Write', added: new Date(1), data: { prefix: 'x!' } },
		{ id: 2, name: 'fremd', twitchId: '30', mode: 'Write', added: new Date(2), data: {} },
	];
	global.bot = {
		Ready: Promise.resolve(),
		Config: { prefix: 'sbn' },
		Users: {
			isAdministrator: (user) => user.data.administrator === true,
			getByTwitchId: async (id) => users.find((u) => u.twitchId === id) ?? null,
			get: async (name) => users.find((u) => u.name === name) ?? null,
			getOrCreate: async (name, { twitchId }) => {
				let user = users.find((u) => u.name === name);
				if (!user) {
					user = { id: users.length + 1, name, twitchId, startedUsing: new Date(), data: {} };
					users.push(user);
				}
				return user;
			},
		},
		Channels: {
			all: () => channels,
			getByTwitchId: (id) => channels.find((c) => c.twitchId === id) ?? null,
			getData: (channel, property) => channel.data[property] ?? null,
			setData: async (channel, property, value) => {
				saved.push(['data', channel.name, property, value]);
				channel.data[property] = value;
			},
			saveProperty: async (channel, property, value) => {
				saved.push(['prop', channel.name, property, value]);
				channel.mode = value;
			},
			add: async (name, mode, twitchId) => channels.push({ id: 9, name, twitchId, mode, added: new Date(), data: {} }),
		},
	};
	db = createCompat({ store: memoryStore(), isServed: (name) => name === 'testaccountalexmoderat' });
});

describe('Mongo-artige Hilfen', () => {
	it('matches: Gleichheit und Operatoren', () => {
		assert.equal(matches({ a: 1, b: { c: 2 } }, { a: 1, 'b.c': 2 }), true);
		assert.equal(matches({ a: 1 }, { a: { $ne: 1 } }), false);
		assert.equal(matches({ a: 3 }, { a: { $gt: 1, $lte: 3 } }), true);
	});
	it('applyUpdate: $set, $inc, $push, bloße Felder', () => {
		const doc = applyUpdate({ n: 1, list: [] }, { $inc: { n: 5 }, $push: { list: 'x' }, $set: { 'a.b': 1 }, level: 0 });
		assert.deepEqual(doc, { n: 6, list: ['x'], a: { b: 1 }, level: 0 });
	});
	it('unbekannter Operator wirft', () => {
		assert.throws(() => applyUpdate({}, { $rename: { a: 'b' } }), /nicht vorgesehen/);
	});
});

describe('bot.DB.users', () => {
	it('findOne({ id }) liefert unseren User mit Dont-Feldern, Level 1', async () => {
		const user = await db.users.findOne({ id: '10' }).exec();
		assert.deepEqual({ id: user.id, username: user.username, level: user.level }, { id: '10', username: 'alice', level: 1 });
	});
	it('Bot-Administrator hat Level 3', async () => {
		users[0].data.administrator = true;
		assert.equal((await db.users.findOne({ id: '10' })).level, 3);
	});
	it('unbekannter User: null', async () => {
		assert.equal(await db.users.findOne({ id: '999' }).exec(), null);
	});
	it('new users({...}).save() legt unseren User an', async () => {
		await new db.users({ id: '77', username: 'neu', firstSeen: new Date(), level: 1 }).save();
		assert.equal(users.at(-1).name, 'neu');
	});
	it('updateOne({ id }, { level: 0 }) wird gemerkt und von find({ level: 0 }) gefunden', async () => {
		await db.users.updateOne({ id: '10' }, { level: 0 }).exec();
		assert.equal((await db.users.findOne({ id: '10' })).level, 0);
		assert.deepEqual(
			(await db.users.find({ level: 0 }).exec()).map((u) => u.id),
			['10'],
		);
	});
});

describe('bot.DB.channels', () => {
	it('find({ isChannel: true }) listet nur bediente Channels (Parallelbetrieb)', async () => {
		const list = await db.channels.find({ isChannel: true }).exec();
		assert.deepEqual(
			list.map((c) => c.username),
			['testaccountalexmoderat'],
		);
	});
	it('findOne({ id }) mit Prefix, editors und optionalSettings wie im Handler benutzt', async () => {
		const channel = await db.channels.findOne({ id: '20' }).exec();
		assert.equal(channel.prefix, 'x!');
		assert.deepEqual([channel.editors, channel.optionalSettings, channel.offlineOnly], [[], {}, false]);
	});
	it('Prefix ohne eigene Einstellung: unser Standard-Prefix statt Donts "|"', async () => {
		channels[0].data = {};
		assert.equal((await db.channels.findOne({ id: '20' })).prefix, 'sbn');
	});
	it('NOTICE msg_banned: updateOne({ username }, { isChannel: false }) setzt den Channel inaktiv', async () => {
		await db.channels.updateOne({ username: 'testaccountalexmoderat' }, { isChannel: false });
		assert.equal(channels[0].mode, 'Inactive');
		assert.deepEqual(saved.at(-1), ['prop', 'testaccountalexmoderat', 'Mode', 'Inactive']);
	});
	it('findOneAndUpdate: prefix und Zusatzfelder (offlineOnly) bleiben erhalten', async () => {
		await db.channels.findOneAndUpdate({ id: '20' }, { $set: { prefix: '!!', offlineOnly: true } }).exec();
		const channel = await db.channels.findOne({ id: '20' });
		assert.equal(channel.prefix, '!!');
		assert.equal(channel.offlineOnly, true);
	});
});

describe('Dokumentenspeicher (poroCount u. a.)', () => {
	it('create, findOne, $inc, find mit sort/limit', async () => {
		await db.poroCount.create({ id: '1', username: 'a', poroCount: 5 });
		await new db.poroCount({ id: '2', username: 'b', poroCount: 9 }).save();
		await db.poroCount.findOneAndUpdate({ id: '1' }, { $inc: { poroCount: 10 } }).exec();
		assert.equal((await db.poroCount.findOne({ id: '1' })).poroCount, 15);
		const top = await db.poroCount.find({}).sort({ poroCount: -1 }).limit(1).exec();
		assert.deepEqual(
			top.map((d) => d.id),
			['1'],
		);
		assert.equal(await db.poroCount.count({}).exec(), 2);
	});
	it('findOne ohne Treffer: null; mit .catch() benutzbar', async () => {
		assert.equal(await db.bans.findOne({ id: 'x' }).catch(() => 'fehler'), null);
	});
});
