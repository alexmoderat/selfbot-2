const test = require('node:test');
const assert = require('node:assert/strict');

// Kleine Attrappe fuer bot.Channels (Daten + Senden), bot.Users und bot.Twitch; keine Datenbank noetig
const sent = [];
const store = new Map();
const channel = { id: 'c1', name: 'someone', mode: 'Write' };
global.bot = {
	Channels: {
		getData: (c, key) => store.get(`${c.id}:${key}`) ?? null,
		setData: async (c, key, value) => void store.set(`${c.id}:${key}`, value),
		send: async (c, text) => void sent.push(text),
		get: () => channel,
	},
	Users: { getOrCreate: async () => ({ ID: 1 }) },
	Twitch: { selfName: 'bot' },
};

const raid = require('../src/clients/modules/chat/raid-notifier.js');

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

test('Standardtext enthaelt immer die eingestellte Zeit am Ende', () => {
	for (const seconds of [120, 67, 20]) {
		const [text] = raid.raidPingMessages(['alice'], raid.defaultText(seconds), seconds);
		assert.equal(text, `@alice ⚡ Raid is happening! Type +join to join! ${seconds} seconds! ⚡`);
	}
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

test('Zaehler je Zeit bleibt beim Entfernen und erneuten Anlegen erhalten, Start bei 0', async () => {
	reset();
	await raid.setEnabled(channel, true);
	assert.deepEqual((await raid.getConfig(channel)).uses, {});
	for (let i = 0; i < 3; i++) {
		await raid.bumpUses(channel, 53);
	}
	await raid.bumpUses(channel, 120);
	await raid.updateItems(channel, (items) => [...items, raid.newItem(2, 53)]);
	// 53-s-Eintrag entfernen und mit derselben Zeit neu anlegen: Zaehler laeuft weiter
	await raid.updateItems(channel, (items) => items.filter((i) => i.seconds !== 53));
	await raid.updateItems(channel, (items) => [...items, raid.newItem(3, 53)]);
	assert.deepEqual((await raid.getConfig(channel)).uses, { 53: 3, 120: 1 });
});

test('Probelauf: nur der Testende wird erwaehnt, Zaehler bleibt, 30 s Sperre', async () => {
	reset();
	const testChannel = { id: 'c-test', name: 'tester', mode: 'Write' };
	await raid.setEnabled(testChannel, true);
	const first = await raid.sendTest(testChannel, 'ninou2');
	assert.deepEqual(first, { sent: 1, durationS: 0, raidStartS: 120 });
	await new Promise((resolve) => setTimeout(resolve, 20)); // 120-s-Eintrag geht sofort (Verzoegerung 0) raus
	assert.match(sent[0], /^@ninou2 ⚡ Raid is happening!.*120 seconds! ⚡$/);
	assert.doesNotMatch(sent[0], /alice|bob/);
	assert.deepEqual((await raid.getConfig(testChannel)).uses, {});
	const again = await raid.sendTest(testChannel, 'ninou2');
	assert.match(again.error, /wait/);
	assert.equal(sent.length, 1);
});

test('Raid Notify: negative Zeit postet so viele Sekunden nach dem Start (ninou2, 19.11.2026: "-1 = 121s, -3 = 123s")', async () => {
	const raid = require('../src/clients/modules/chat/raid-notifier.js');
	const delays = [];
	const realTimeout = global.setTimeout;
	global.setTimeout = (fn, ms) => {
		delays.push(ms);
		return { unref() {} };
	};
	const savedBot = global.bot;
	const channel = { id: 991, name: 'zzqchannel', mode: 'Write' };
	global.bot = {
		Channels: {
			get: () => channel,
			getData: () => ({ enabled: true, items: [{ id: 1, on: true, seconds: -3, text: null, times: 1 }, { id: 2, on: true, seconds: 0, text: null, times: 1 }], uses: {} }),
			setData: async () => {},
			send: async () => {},
		},
	};
	try {
		await raid.runRaid(new Map([[991, ['zzquser']]]), 120);
	} finally {
		global.setTimeout = realTimeout;
		global.bot = savedBot;
	}
	assert.deepEqual(delays.sort((a, b) => a - b), [120_000, 123_000]);
});
