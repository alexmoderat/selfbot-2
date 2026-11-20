const test = require('node:test');
const assert = require('node:assert/strict');
const { isTimerDue, parseTimerInterval, timerMode, formatInterval, withGroupLastSent } = require('../src/misc/timers.js');

const base = { Enabled: true, Online_Only: false, Offline_Only: false, Interval_Seconds: 3610, Last_Sent: null };
const now = Date.parse('2026-11-19T20:00:00Z');

test('Timer: 1h10s als Intervall (automatisches +ed, 19.11.2026)', () => {
	assert.equal(parseTimerInterval('1h10s'), 3_610_000);
	assert.equal(parseTimerInterval('71m'), 4_260_000);
});

test('Timer: nur offline sendet nur bei sicher offline', () => {
	const timer = { ...base, Offline_Only: true };
	assert.equal(isTimerDue(timer, false, now), true);
	assert.equal(isTimerDue(timer, true, now), false);
	assert.equal(isTimerDue(timer, null, now), false); // Status unbekannt: lieber nicht
	assert.equal(isTimerDue({ ...timer, Last_Sent: now - 3_600_000 }, false, now), false); // 1 h < 1 h 10 s
	assert.equal(isTimerDue({ ...timer, Last_Sent: now - 3_610_000 }, false, now), true);
});

test('Timer: live only und immer unveraendert', () => {
	assert.equal(isTimerDue({ ...base, Online_Only: true }, true, now), true);
	assert.equal(isTimerDue({ ...base, Online_Only: true }, false, now), false);
	assert.equal(isTimerDue(base, null, now), true);
	assert.equal(isTimerDue({ ...base, Enabled: false }, false, now), false);
});

test('Timer: Anzeige der Bedingung', () => {
	assert.equal(timerMode({ Online_Only: true }), 'live only');
	assert.equal(timerMode({ Online_Only: false }), 'always');
	assert.equal(timerMode({ Online_Only: false, Offline_Only: true }), 'offline only');
});

test('Timer: whenlive - nur wenn der andere Channel sicher live ist', () => {
	const timer = { ...base, Offline_Only: true, Live_Channel: 70 };
	assert.equal(isTimerDue(timer, false, now, true), true); // hier offline, ninou2 live
	assert.equal(isTimerDue(timer, false, now, false), false); // ninou2 offline
	assert.equal(isTimerDue(timer, false, now, null), false); // unbekannt
	assert.equal(isTimerDue(timer, true, now, true), false); // hier selbst live
	assert.equal(isTimerDue({ ...base, Offline_Only: true }, false, now), true); // ohne whenlive wie bisher
});

test('Timer: Intervall genau mit Sekunden anzeigen', () => {
	assert.equal(formatInterval(3610), '1h 10s');
	assert.equal(formatInterval(14_400), '4h');
	assert.equal(formatInterval(90_061), '1d 1h 1m 1s');
});

test('Timer-Cron: sendet faellige Timer wirklich (07.-19.11.2026 still uebersprungen, "writable" gab es nicht mehr)', async () => {
	const servicesPath = require.resolve('../src/util/timers.js');
	const saved = require.cache[servicesPath];
	const sent = [];
	const marked = [];
	const timer = { ID: 4, Channel: 70, Message: '+ed', Interval_Seconds: 3610, Online_Only: false, Offline_Only: true, Live_Channel: null, Enabled: true, Last_Sent: null };
	require.cache[servicesPath] = {
		id: servicesPath,
		filename: servicesPath,
		loaded: true,
		exports: { listEnabled: async () => [timer], markSent: async (t) => marked.push(t.ID) },
	};
	const cronPath = require.resolve('../src/clients/modules/crons/timers.js');
	delete require.cache[cronPath];
	const channels = { 70: { id: 70, name: 'ninou2', mode: 'Write' }, 71: { id: 71, name: 'zzq', mode: 'Read' } };
	const prevBot = global.bot;
	global.bot = {
		Channels: {
			get: (id) => channels[id],
			isWritable: (c) => c.mode !== 'Inactive' && c.mode !== 'Read',
			isLive: () => false, // synchron wie src/services/channels.js
			send: async (c, text) => sent.push(`${c.name}: ${text}`),
		},
	};
	try {
		const cron = require('../src/clients/modules/crons/timers.js');
		await cron.code();
		assert.deepEqual(sent, ['ninou2: +ed']);
		assert.deepEqual(marked, [4]);

		// Nur-lesen-Channel: nichts senden
		sent.length = 0;
		Object.assign(timer, { Channel: 71 });
		await cron.code();
		assert.deepEqual(sent, []);
	} finally {
		global.bot = prevBot;
		delete require.cache[cronPath];
		if (saved) {
			require.cache[servicesPath] = saved;
		} else {
			delete require.cache[servicesPath];
		}
	}
});

test('Timer: Sync-Gruppe zaehlt ab dem letzten Senden irgendeines Timers der Gruppe (ninou2, 19.11.2026)', () => {
	const a = { ...base, ID: 4, Sync_Group: 'ed', Last_Sent: now - 32 * 60_000 };
	const b = { ...base, ID: 5, Sync_Group: 'ed', Last_Sent: null };
	const other = { ...base, ID: 3, Sync_Group: null, Last_Sent: now - 1000 };
	const all = [a, b, other];
	assert.equal(withGroupLastSent(b, all).Last_Sent, a.Last_Sent);
	assert.equal(isTimerDue(withGroupLastSent(b, all), false, now), false); // erst 32 min seit #4
	assert.equal(isTimerDue(withGroupLastSent({ ...b }, [{ ...a, Last_Sent: now - 3_610_000 }, b]), false, now), true);
	assert.equal(withGroupLastSent(other, all), other); // ohne Gruppe unveraendert
	assert.equal(withGroupLastSent({ ...base, Sync_Group: 'x', Last_Sent: null }, all).Last_Sent, null);
});

test('Timer-Cron: zwei Timer derselben Gruppe senden nicht im selben Durchlauf', async () => {
	const servicesPath = require.resolve('../src/util/timers.js');
	const saved = require.cache[servicesPath];
	const sent = [];
	const list = [
		{ ID: 4, Channel: 70, Message: '+ed', Interval_Seconds: 3610, Online_Only: false, Offline_Only: true, Live_Channel: null, Sync_Group: 'ed', Enabled: true, Last_Sent: null },
		{ ID: 5, Channel: 69, Message: '+ed', Interval_Seconds: 3610, Online_Only: false, Offline_Only: true, Live_Channel: null, Sync_Group: 'ed', Enabled: true, Last_Sent: null },
	];
	require.cache[servicesPath] = { id: servicesPath, filename: servicesPath, loaded: true, exports: { listEnabled: async () => list, markSent: async () => {} } };
	const cronPath = require.resolve('../src/clients/modules/crons/timers.js');
	delete require.cache[cronPath];
	const channels = { 70: { id: 70, name: 'ninou2', mode: 'Write' }, 69: { id: 69, name: 'ajspyman', mode: 'Write' } };
	const prevBot = global.bot;
	global.bot = {
		Channels: {
			get: (id) => channels[id],
			isWritable: () => true,
			isLive: () => false,
			send: async (c, text) => sent.push(`${c.name}: ${text}`),
		},
	};
	try {
		await require('../src/clients/modules/crons/timers.js').code();
		assert.deepEqual(sent, ['ninou2: +ed']);
	} finally {
		global.bot = prevBot;
		delete require.cache[cronPath];
		if (saved) {
			require.cache[servicesPath] = saved;
		} else {
			delete require.cache[servicesPath];
		}
	}
});
