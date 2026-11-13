const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { parseBadges, parseEmotes, parseEvents } = require('../src/misc/streamdatabase.js');
const { newBadges, formatBadge, formatEmote } = require('../src/crons/badge-watch.js');

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

test('Emotes aus der Seite lesen und melden', () => {
	const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { twitchGlobalEmotes: [{ current: { id: '1', name: ':)' } }, { current: { id: '2', name: 'TakisAllIntense' } }, { current: {} }] } } })}</script>`;
	const emotes = parseEmotes(html);
	assert.deepEqual(emotes, [
		{ key: '1', title: ':)' },
		{ key: '2', title: 'TakisAllIntense' },
	]);
	assert.deepEqual(
		newBadges(emotes, new Set(['1'])).map((i) => i.title),
		['TakisAllIntense'],
	);
	assert.ok(formatEmote(emotes[1], 'Pog').startsWith('New global Twitch emote: TakisAllIntense'));
	assert.ok(formatEmote(emotes[1], 'Pog').endsWith('Pog'));
});

test('Aktionen: wie und bis wann', () => {
	const events = parseEvents({
		data: [
			{
				title: 'Pentakill Fan',
				end_at_date: '2026-11-13',
				twitch_global_badges: [
					{
						current: { set_id: 'pentakill-fan', version: { id: '1' } },
						availability: [{ watch: true, watch_minutes: 30, end_at_date: '2026-11-13' }],
					},
				],
			},
			{ title: 'Ohne Badges' },
		],
	});
	assert.deepEqual(events.get('pentakill-fan:1'), { how: 'watch 30 min', until: '2026-11-13', event: 'Pentakill Fan' });
	assert.equal(events.size, 1);
	const text = formatBadge({ title: 'Pentakill Fan', description: 'Fan badge' }, '', events.get('pentakill-fan:1'));
	assert.ok(text.includes('[watch 30 min, until 2026-11-13]'));
	assert.ok(!formatBadge({ title: 'X', description: '' }).includes('['));
});

test('badgeAlerts ist als Channel-Eigenschaft deklariert (sonst "Unknown channel data property")', () => {
	const { channelDataSchema, checkValue } = require('../src/services/data-properties.js');
	assert.equal(channelDataSchema.badgeAlerts, 'object');
	assert.ok(checkValue('object', { enabled: true, message: 'hi' }));
});
