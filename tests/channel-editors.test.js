const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const editors = require('../src/selfbot/util/channel-editors.js');
const { createCompat } = require('../src/database/db.js');

const memoryStore = () => {
	const data = new Map();
	return {
		list: async (collection) => [...(data.get(collection)?.values() ?? [])].map((doc) => structuredClone(doc)),
		put: async (collection, key, doc) => void data.set(collection, (data.get(collection) ?? new Map()).set(key, structuredClone(doc))),
		remove: async (collection, key) => void data.get(collection)?.delete(key),
	};
};

const channel = { id: 1, name: 'testaccountalexmoderat', twitchId: '20', mode: 'Write', added: new Date(1), data: {} };

beforeEach(() => {
	global.bot = {
		Ready: Promise.resolve(),
		Config: { prefix: 'dnt' },
		Channels: { all: () => [channel], getByTwitchId: () => channel, getData: () => null, setData: async () => {}, saveProperty: async () => {} },
	};
	bot.DB = createCompat({ store: memoryStore(), isServed: () => true });
});

describe('Channel-Editoren', () => {
	it('leer am Anfang', async () => {
		assert.deepEqual(await editors.list(channel), []);
	});
	it('hinzufuegen, doppelt abgelehnt, Broadcaster abgelehnt', async () => {
		const result = await editors.add(channel, { id: '55', login: 'helper' });
		assert.deepEqual(
			result.editors.map((i) => [i.username, i.id]),
			[['helper', '55']],
		);
		assert.match((await editors.add(channel, { id: '55', login: 'helper' })).error, /already/);
		assert.match((await editors.add(channel, { id: '20', login: 'testaccountalexmoderat' })).error, /broadcaster/);
	});
	it('Donts Handler liest dieselbe Liste (mongoChannel.editors.find)', async () => {
		await editors.add(channel, { id: '55', login: 'helper' });
		const doc = await bot.DB.channels.findOne({ id: '20' }).exec();
		assert.equal(Boolean(doc.editors.find((x) => x.id === '55')), true);
	});
	it('entfernen', async () => {
		await editors.add(channel, { id: '55', login: 'helper' });
		assert.deepEqual((await editors.remove(channel, 'Helper')).editors, []);
		assert.match((await editors.remove(channel, 'helper')).error, /not an editor/);
	});
	it('Obergrenze', async () => {
		for (let i = 0; i < editors.MAX_EDITORS; i++) {
			await editors.add(channel, { id: `u${i}`, login: `user${i}` });
		}
		assert.match((await editors.add(channel, { id: 'x', login: 'extra' })).error, /At most/);
	});
});
