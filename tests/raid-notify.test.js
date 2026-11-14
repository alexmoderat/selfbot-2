const test = require('node:test');
const assert = require('node:assert/strict');

// Kleine Attrappe fuer bot.Channels (Daten + Senden), bot.Users und bot.Twitch; keine Datenbank noetig
const sent = [];
const store = new Map();
const channel = { id: 'c1', name: 'someone', mode: 'Write' };
global.bot = {
	Channels: {
		getData: async (c, key) => store.get(`${c.id}:${key}`) ?? null,
		setData: async (c, key, value) => void store.set(`${c.id}:${key}`, value),
		send: async (c, text) => void sent.push(text),
		get: () => channel,
	},
	Users: { getOrCreate: async () => ({ ID: 1 }) },
	Twitch: { selfName: 'bot' },
};

const raid = require('../src/modules/raid-notifier.js');

const reset = () => {
	store.clear();
	sent.length = 0;
};

test('Einschalten ohne Eintraege legt genau den 120-s-Eintrag mit Standardtext an', async () => {
	reset();
	const config = await raid.setEnabled(channel, true);
	assert.equal(config.enabled, true);
	assert.equal(config.items.length, 1);
	assert.equal(config.items[0].seconds, 120);
	assert.equal(config.items[0].text, null);
	assert.equal(config.items[0].times, 1);
});

test('Sind alle Eintraege aus oder entfernt, schaltet sich Raid Notify selbst aus', async () => {
	reset();
	await raid.setEnabled(channel, true);
	let config = await raid.updateItems(channel, (items) => [...items, raid.newItem(2)]);
	assert.equal(config.enabled, true);
	config = await raid.updateItems(channel, (items) => items.map((i) => ({ ...i, on: false })));
	assert.equal(config.enabled, false);
	// erneut einschalten: es gibt keinen aktiven Eintrag mehr, also entsteht wieder der Standard-Eintrag
	config = await raid.setEnabled(channel, true);
	assert.deepEqual(
		config.items.map((i) => [i.seconds, i.on]),
		[[120, true]],
	);
	config = await raid.updateItems(channel, () => []);
	assert.equal(config.enabled, false);
});

test('Alte Einstellung (enabled + seconds) wird einmal in die Liste uebernommen', async () => {
	reset();
	store.set('c1:raidNotify', { enabled: true, seconds: 30 });
	const config = await raid.getConfig(channel);
	assert.deepEqual(
		config.items.map((i) => [i.seconds, i.on, i.times]),
		[
			[120, true, 1],
			[30, true, 1],
		],
	);
	assert.deepEqual(store.get('c1:raidNotify').items.length, 2);
});

test('Standardtexte: 120 s = Ping, darunter Erinnerung mit {seconds}', () => {
	assert.equal(raid.defaultText(120), raid.DEFAULT_RAID_MESSAGE);
	assert.equal(raid.defaultText(20), raid.DEFAULT_RAID_REMINDER);
});

test('runRaid: 120-s-Eintrag sofort, x2 postet zweimal, ausgeschaltete und spaetere nicht', async () => {
	reset();
	await raid.setEnabled(channel, true);
	await raid.updateItems(channel, (items) => [{ ...items[0], times: 2 }, { ...raid.newItem(2, 20), on: false }]);
	// Eintrag 2 ist aus; da Eintrag 1 an ist, bleibt Raid Notify an
	const batches = await raid.runRaid(new Map([['c1', ['alice', 'bob']]]), 120);
	assert.equal(batches, 1);
	assert.equal(sent.length, 2);
	assert.match(sent[0], /@alice @bob/);
});

test('runRaid: Eintraege mit mehr Sekunden als die Dauer kommen sofort, kuerzere werden eingeplant', async (t) => {
	reset();
	await raid.setEnabled(channel, true);
	await raid.updateItems(channel, (items) => [...items, raid.newItem(2, 90), raid.newItem(3, 20)]);
	const timers = [];
	t.mock.method(global, 'setTimeout', (fn, ms) => timers.push(ms));
	// Event mit 60 s Vorlauf: 120 und 90 sind schon vorbei -> beide sofort, 20 s in 40 s
	await raid.runRaid(new Map([['c1', ['alice']]]), 60);
	assert.equal(sent.length, 2);
	assert.deepEqual(timers, [40_000]);
});

test('runRaid ohne bekannte Dauer: nur die 120-s-Eintraege, nichts eingeplant', async (t) => {
	reset();
	await raid.setEnabled(channel, true);
	await raid.updateItems(channel, (items) => [...items, raid.newItem(2, 20)]);
	const timers = [];
	t.mock.method(global, 'setTimeout', (fn, ms) => timers.push(ms));
	await raid.runRaid(new Map([['c1', ['alice']]]), 0);
	assert.equal(sent.length, 1);
	assert.deepEqual(timers, []);
});
