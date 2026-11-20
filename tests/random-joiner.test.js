const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSlots, pickCandidates, selectRotation } = require('../src/selfbot/util/random-joiner.js');

test('Plaetze bleiben unter dem Join-Limit von 100 inkl. Nicht-Mod-IRC-Channels', () => {
	assert.equal(computeSlots(75, 18), 75);
	assert.equal(computeSlots(200, 18), 77);
	assert.equal(computeSlots(75, 99), 0);
	assert.equal(computeSlots(10, 0), 10);
});

test('Kandidaten: Zuschauerbereich, keine Doppelten, keine ausgeschlossenen', () => {
	const streams = [
		{ user_id: '1', user_login: 'zzqa', viewer_count: 5 },
		{ user_id: '2', user_login: 'zzqb', viewer_count: 5000 },
		{ user_id: '3', user_login: 'zzqc', viewer_count: 0 },
		{ user_id: '4', user_login: 'zzqd', viewer_count: 50 },
		{ user_id: '4', user_login: 'zzqd', viewer_count: 50 },
		{ user_id: '5', user_login: 'zzqe', viewer_count: 20 },
	];
	const picked = pickCandidates(streams, { exclude: new Set(['5']), minViewers: 1, maxViewers: 1000, count: 10, random: () => 0 });
	assert.deepEqual(picked.map((i) => i.user_id).sort(), ['1', '4']);
	assert.equal(pickCandidates(streams, { exclude: new Set(), minViewers: 1, maxViewers: 1000, count: 1 }).length, 1);
});

test('Rotation: offline immer raus, dazu die aeltesten bis zum Anteil', () => {
	const entries = [
		{ id: 'a', joinedAt: 1 },
		{ id: 'b', joinedAt: 2 },
		{ id: 'c', joinedAt: 3 },
		{ id: 'd', joinedAt: 4 },
		{ id: 'e', joinedAt: 5 },
		{ id: 'f', joinedAt: 6 },
		{ id: 'g', joinedAt: 7 },
		{ id: 'h', joinedAt: 8 },
	];
	// 25 % von 8 = 2; einer offline -> noch der aelteste Online-Channel
	assert.deepEqual(
		selectRotation(entries, new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).map((i) => i.id),
		['h', 'a'],
	);
	// mehr offline als der Anteil: nur die offline
	assert.deepEqual(
		selectRotation(entries, new Set(['a', 'b', 'c', 'd', 'e'])).map((i) => i.id),
		['f', 'g', 'h'],
	);
});
