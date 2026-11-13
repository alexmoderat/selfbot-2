const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { parseBadges } = require('../src/misc/streamdatabase.js');
const { newBadges, formatBadge } = require('../src/crons/badge-watch.js');

const page = (list) =>
	`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialTwitchGlobalBadges: list } } })}</script></html>`;
const item = (set_id, id, extra = {}) => ({ current: { set_id, version: { id, title: `T ${set_id}`, description: `D ${set_id}` } }, ...extra });

test('Badges aus der Seite lesen, entfernte auslassen', () => {
	const badges = parseBadges(page([item('a', '1'), item('b', '2', { removed: '2026-01-01' }), item('c', '1')]));
	assert.deepEqual(
		badges.map((i) => i.key),
		['a:1', 'c:1'],
	);
	assert.equal(badges[0].title, 'T a');
	assert.throws(() => parseBadges('<html></html>'));
});

test('Erstlauf meldet nichts, danach nur Neues', () => {
	const badges = parseBadges(page([item('a', '1'), item('b', '1')]));
	assert.deepEqual(newBadges(badges, null), []);
	assert.deepEqual(
		newBadges(badges, new Set(['a:1'])).map((i) => i.key),
		['b:1'],
	);
});

test('Meldung mit eigenem Textteil', () => {
	const text = formatBadge({ title: 'Gallica', description: 'Sub badge' }, 'PogChamp');
	assert.ok(text.startsWith('New global Twitch badge: Gallica - Sub badge'));
	assert.ok(text.endsWith('PogChamp'));
	assert.ok(!formatBadge({ title: 'X', description: '' }).endsWith(' '));
});
