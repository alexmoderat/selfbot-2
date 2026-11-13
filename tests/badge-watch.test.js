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

test('formatMany: mehrere neue in einer Sammelmeldung, lange Listen werden aufgeteilt', () => {
	const { formatMany } = require('../src/crons/badge-watch.js');
	const items = [{ key: 'a:1', title: 'Alpha' }, { key: 'b:1', title: 'Beta' }];
	const events = new Map([['a:1', { how: 'watch 30 min', until: '2026-11-15' }]]);
	const [one, ...rest] = formatMany('badge', items, 'hi', events);
	assert.equal(rest.length, 0);
	assert.ok(one.startsWith('New global Twitch badges (2): Alpha [watch 30 min, until 2026-11-15], Beta ('));
	assert.ok(one.endsWith(' hi'));
	const many = formatMany('emote', Array.from({ length: 60 }, (_, i) => ({ key: `e${i}`, title: `Emote${i}` })));
	assert.ok(many.length > 1);
	assert.ok(many.every((m) => m.length < 500));
});

test('!badgeinfo: Anzahl 1-5, Badges und Emotes gemischt, neueste zuerst', () => {
	const { parseCount, mergeRecent, formatRecent } = require('../src/commands/badgeinfo.js');
	assert.equal(parseCount([]), 1);
	assert.equal(parseCount(['3']), 3);
	assert.equal(parseCount(['9']), 5);
	assert.equal(parseCount(['0']), 1);
	assert.equal(parseCount(['abc']), 1);
	const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
	const merged = mergeRecent([{ title: 'B1', at: at(300) }, { title: 'B2', at: at(120) }], [{ title: 'E1', at: at(125) }], 3);
	assert.deepEqual(merged.map((i) => `${i.kind}:${i.title}`), ['badge:B2', 'emote:E1', 'badge:B1']);
	const one = formatRecent([{ kind: 'badge', title: 'Alpha', description: 'Desc', how: 'watch 30 min', until: '2026-11-15', at: at(125) }]);
	assert.equal(one, 'Last global Twitch badge: Alpha - Desc [watch 30 min, until 2026-11-15] (2h5min ago)');
	assert.equal(formatRecent([{ kind: 'emote', title: 'Foo', at: at(5) }]), 'Last global Twitch emote: Foo (5min ago)');
	assert.equal(formatRecent(merged.slice(0, 2)), 'Last 2 global Twitch infos: badge B2 (2h0min ago), emote E1 (2h5min ago)');
});

test('badge-history: neueste zuerst, nach KEEP abgeschnitten', async () => {
	const store = new Map();
	global.bot.Redis = { getJSON: async (k) => store.get(k) ?? null, setJSON: async (k, v) => store.set(k, v) };
	const { recordRecent, getRecent, KEEP } = require('../src/misc/badge-history.js');
	await recordRecent('badge', [{ title: 'A' }, { title: 'B' }], '2026-11-13T10:00:00.000Z');
	await recordRecent('badge', [{ title: 'C' }], '2026-11-13T11:00:00.000Z');
	assert.deepEqual((await getRecent('badge', 5)).map((i) => i.title), ['C', 'B', 'A']);
	assert.equal((await getRecent('badge', 2)).length, 2);
	await recordRecent('badge', Array.from({ length: 30 }, (_, i) => ({ title: `x${i}` })));
	assert.equal((await getRecent('badge', 99)).length, KEEP);
	assert.deepEqual(await getRecent('emote', 3), []);
});

test('Tweets: parseTweets (ohne angehefteten und t.co-Links) und parseGlobalTweet', () => {
	const { parseTweets, parseGlobalTweet } = require('../src/misc/streamdatabase.js');
	const body = {
		data: {
			timeline: [
				{ id_str: '1', _probably_pinned: true, full_text: 'pinned', created_at: 'Sun Jul 26 17:47:59 +0000 2026' },
				{ id_str: '2', full_text: 'Twitch global badge added: Silver Chain https://t.co/abc', created_at: 'Fri Nov 13 18:09:25 +0000 2026' },
				{ id_str: '3', full_text: 'Twitch global badge now available: Jordan\n\nObjective\n- Watch 15 minutes.', created_at: 'Fri Nov 13 20:33:42 +0000 2026' },
			],
		},
	};
	const tweets = parseTweets(body);
	assert.deepEqual(tweets.map((i) => i.id), ['3', '2']);
	assert.equal(tweets[1].text, 'Twitch global badge added: Silver Chain');
	assert.deepEqual(parseGlobalTweet(tweets[1].text), { kind: 'badge', what: 'added', rest: 'Silver Chain' });
	assert.equal(parseGlobalTweet(tweets[0].text).what, 'now available');
	assert.equal(parseGlobalTweet('Learn more:'), null);
	const { titleOf, formatTweet } = require('../src/crons/tweet-watch.js');
	assert.equal(titleOf('Jordan x Space Jam Objective - Watch 15 minutes.'), 'Jordan x Space Jam');
	assert.equal(formatTweet({ id: '9', text: 'Hi' }, 'x'), 'Hi (https://x.com/StreamDatabase/status/9) x');
});

test('badge-history: wasAnnounced/markAnnounced', async () => {
	const store = new Map();
	global.bot.Redis = { getJSON: async (k) => store.get(k) ?? null, setJSON: async (k, v) => store.set(k, v) };
	const { wasAnnounced, markAnnounced } = require('../src/misc/badge-history.js');
	assert.equal(await wasAnnounced('added:badge:x'), false);
	await markAnnounced('added:badge:x');
	assert.equal(await wasAnnounced('added:badge:x'), true);
});
