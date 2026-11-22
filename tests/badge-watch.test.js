const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { parseBadges, parseEmotes, parseEvents } = require('../src/token/streamdatabase.js');
const { newBadges, formatBadge, formatEmote } = require('../src/clients/modules/crons/badge-watch.js');

const page = (list) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialTwitchGlobalBadges: list } } })}</script></html>`;
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
	const { channelDataSchema, checkValue } = require('../src/util/data-properties.js');
	assert.equal(channelDataSchema.badgeAlerts, 'object');
	assert.ok(checkValue('object', { enabled: true, message: 'hi' }));
});

test('formatMany: mehrere neue in einer Sammelmeldung, lange Listen werden aufgeteilt', () => {
	const { formatMany } = require('../src/clients/modules/crons/badge-watch.js');
	const items = [
		{ key: 'a:1', title: 'Alpha' },
		{ key: 'b:1', title: 'Beta' },
	];
	const events = new Map([['a:1', { how: 'watch 30 min', until: '2026-11-15' }]]);
	const [one, ...rest] = formatMany('badge', items, 'hi', events);
	assert.equal(rest.length, 0);
	assert.ok(one.startsWith('New global Twitch badges (2): Alpha [watch 30 min, until 2026-11-15], Beta ('));
	assert.ok(one.endsWith(' hi'));
	const many = formatMany(
		'emote',
		Array.from({ length: 60 }, (_, i) => ({ key: `e${i}`, title: `Emote${i}` })),
	);
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
	const merged = mergeRecent(
		[
			{ title: 'B1', at: at(300) },
			{ title: 'B2', at: at(120) },
		],
		[{ title: 'E1', at: at(125) }],
		3,
	);
	assert.deepEqual(
		merged.map((i) => `${i.kind}:${i.title}`),
		['badge:B2', 'emote:E1', 'badge:B1'],
	);
	const one = formatRecent([{ kind: 'badge', title: 'Alpha', description: 'Desc', how: 'watch 30 min', until: '2026-11-15', at: at(125) }]);
	assert.equal(one, 'Last global Twitch badge: Alpha - Desc [watch 30 min, until 2026-11-15] (2h 5min ago)');
	assert.equal(formatRecent([{ kind: 'emote', title: 'Foo', at: at(5) }]), 'Last global Twitch emote: Foo (5min ago)');
	assert.equal(formatRecent(merged.slice(0, 2)), 'Last 2 global Twitch infos: badge B2 (2h 0min ago), emote E1 (2h 5min ago)');
});

test('badge-history: neueste zuerst, nach KEEP abgeschnitten', async () => {
	const store = new Map();
	global.bot.Cache = { getJSON: async (k) => store.get(k) ?? null, setJSON: async (k, v) => store.set(k, v) };
	const { recordRecent, getRecent, KEEP } = require('../src/util/badge-history.js');
	await recordRecent('badge', [{ title: 'A' }, { title: 'B' }], '2026-11-13T10:00:00.000Z');
	await recordRecent('badge', [{ title: 'C' }], '2026-11-13T11:00:00.000Z');
	assert.deepEqual(
		(await getRecent('badge', 5)).map((i) => i.title),
		['C', 'B', 'A'],
	);
	assert.equal((await getRecent('badge', 2)).length, 2);
	await recordRecent(
		'badge',
		Array.from({ length: 30 }, (_, i) => ({ title: `x${i}` })),
	);
	assert.equal((await getRecent('badge', 99)).length, KEEP);
	assert.deepEqual(await getRecent('emote', 3), []);
});

test('Tweets: parseTweets (ohne angehefteten und t.co-Links) und parseGlobalTweet', () => {
	const { parseTweets, parseGlobalTweet } = require('../src/token/streamdatabase.js');
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
	assert.deepEqual(
		tweets.map((i) => i.id),
		['3', '2'],
	);
	assert.equal(tweets[1].text, 'Twitch global badge added: Silver Chain');
	assert.deepEqual(parseGlobalTweet(tweets[1].text), { kind: 'badge', what: 'added', rest: 'Silver Chain' });
	assert.equal(parseGlobalTweet(tweets[0].text).what, 'now available');
	assert.equal(parseGlobalTweet('Learn more:'), null);
});

test('badge-history: wasAnnounced/markAnnounced', async () => {
	const store = new Map();
	global.bot.Cache = { getJSON: async (k) => store.get(k) ?? null, setJSON: async (k, v) => store.set(k, v) };
	const { wasAnnounced, markAnnounced } = require('../src/util/badge-history.js');
	assert.equal(await wasAnnounced('added:badge:x'), false);
	await markAnnounced('added:badge:x');
	assert.equal(await wasAnnounced('added:badge:x'), true);
});

test('!badgeinfo: Verfuegbarkeits-Tweet mit Link', () => {
	const { mergeRecent, formatRecent } = require('../src/commands/badgeinfo.js');
	const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
	const tweet = { title: 'Twitch global badge now available: Jordan', link: 'https://x.com/StreamDatabase/status/1', at: at(10) };
	const merged = mergeRecent([{ title: 'B', at: at(60) }], [], 2, [tweet]);
	assert.deepEqual(
		merged.map((i) => i.kind),
		['tweet', 'badge'],
	);
	assert.equal(formatRecent([merged[0]]), 'Last global Twitch info: Twitch global badge now available: Jordan https://x.com/StreamDatabase/status/1 (10min ago)');
	assert.ok(formatRecent(merged).includes('tweet https://x.com/StreamDatabase/status/1 (10min ago), badge B (1h 0min ago)'));
});

test('Zeitfenster: [AVAILABLE!] solange offen, [ENDED!] danach', () => {
	const { parseEventEnd, eventStatus } = require('../src/token/streamdatabase.js');
	const text = 'Twitch global badge now available: Jordan Objective - Watch 15 minutes. The event ends November 13, 2026 at 21:59. (UTC) Good luck!';
	assert.equal(parseEventEnd(text), Date.parse('2026-11-13T21:59:00Z'));
	assert.equal(eventStatus(text, Date.parse('2026-11-13T21:00:00Z')), '[AVAILABLE!]');
	assert.equal(eventStatus(text, Date.parse('2026-11-13T22:00:00Z')), '[ENDED!]');
	assert.equal(eventStatus('Twitch global badge added: Silver Chain'), null);
});

test('!badgeinfo: Tweet mit Status hinter dem Text', () => {
	const { formatRecent } = require('../src/commands/badgeinfo.js');
	const title = 'Twitch global badge now available: Jordan The event ends November 13, 2000 at 21:59. (UTC) Good luck!';
	const entry = { kind: 'tweet', title, link: 'https://x.com/s/1', at: new Date(Date.now() - 60_000).toISOString() };
	assert.equal(formatRecent([entry]), `Last global Twitch info: ${title} [ENDED!] https://x.com/s/1 (1min ago)`);
});

test('Zeitfenster aus den Aktionen: parseWindows und activeWindows', () => {
	const { parseWindows, activeWindows } = require('../src/token/streamdatabase.js');
	const json = {
		data: [
			{
				title: 'K/DA Fan',
				start_at_date: '2026-11-13',
				start_at_time: '16:00',
				end_at_date: '2026-11-15',
				end_at_time: '15:59',
				twitch_global_badges: [
					{
						current: { set_id: 'kda-fan', version: { id: '1', title: 'K/DA Fan' } },
						availability: [{ watch: true, watch_minutes: 30, start_at_date: '2026-11-13', start_at_time: '16:00', end_at_date: '2026-11-15', end_at_time: '15:59' }],
					},
				],
			},
			{ title: 'Versteckt', hidden: true, twitch_global_badges: [{ current: { set_id: 'x', version: { id: '1' } }, availability: [{ end_at_date: '2026-11-15' }] }] },
		],
	};
	const windows = parseWindows(json);
	assert.equal(windows.length, 1);
	assert.equal(windows[0].how, 'watch 30 min');
	assert.equal(windows[0].startMs, Date.parse('2026-11-13T16:00:00Z'));
	assert.equal(windows[0].endMs, Date.parse('2026-11-15T15:59:00Z'));
	assert.equal(activeWindows(windows, Date.parse('2026-11-13T15:59:00Z')).length, 0);
	assert.equal(activeWindows(windows, Date.parse('2026-11-13T16:00:00Z')).length, 1);
	assert.equal(activeWindows(windows, Date.parse('2026-11-15T16:00:00Z')).length, 0);
	const { formatWindow } = require('../src/clients/modules/crons/event-watch.js');
	assert.equal(formatWindow(windows[0]), 'Twitch global badge now available: K/DA Fan [watch 30 min] The event ends November 15, 2026 at 15:59. (UTC)');
	const { eventStatus } = require('../src/token/streamdatabase.js');
	assert.equal(eventStatus(formatWindow(windows[0]), Date.parse('2026-11-14T00:00:00Z')), '[AVAILABLE!]');
});

test('Raid Notify: Zeitpunkt der Erinnerung wird auf -30 bis 120 Sekunden begrenzt (0 = beim Start, negativ = danach)', () => {
	const { clampLead, MIN_LEAD_S, MAX_LEAD_S } = require('../src/clients/modules/chat/raid-notifier.js');
	assert.equal(MIN_LEAD_S, -30);
	assert.equal(MAX_LEAD_S, 120);
	assert.equal(clampLead(undefined), 20);
	assert.equal(clampLead('abc'), 20);
	assert.equal(clampLead(0), 0);
	assert.equal(clampLead('0'), 0);
	assert.equal(clampLead(-3), -3);
	assert.equal(clampLead('-10'), -10);
	assert.equal(clampLead('-12'), -12);
	assert.equal(clampLead(-50), -30);
	assert.equal(clampLead(500), 120);
	assert.equal(clampLead('45'), 45);
});

test('event-watch: Tweet-Notify-Abonnenten bekommen eigenen Text und Anzahl, Badge-Alert-Text entfaellt dort', async () => {
	const sent = [];
	const channel = { id: 70, name: 'ninou2', Platform: 'twitch', mode: 'Write' };
	const redis = { store: new Map() };
	const windows = require('../src/token/streamdatabase.js');
	const origFetch = windows.fetchWindows;
	const origActive = windows.activeWindows;
	let active = [];
	windows.fetchWindows = async () => [];
	windows.activeWindows = () => active;
	delete require.cache[require.resolve('../src/clients/modules/crons/event-watch.js')]; // damit die Stubs greifen
	const { runEventWatch } = require('../src/clients/modules/crons/event-watch.js');
	const saved = global.bot;
	global.bot = {
		Cache: { getJSON: async (k) => redis.store.get(k) ?? null, setJSON: async (k, v) => void redis.store.set(k, v) },
		Channels: { get: () => channel, all: () => [channel], getData: async () => ({ enabled: true, message: 'ALT' }), send: async (c, t) => void sent.push(t) },
		Users: { get: async () => ({ name: 'ninou2' }) },
		DB: { TweetNotify: { find: () => ({ lean: async () => [{ channel: 70, account: 'streamdatabase', userAlias: 1, message: 'NEU', times: 2 }] }) } },
		Twitch: 'twitch',
	};
	try {
		await runEventWatch(); // Erstlauf
		active = [{ key: 'k', setId: 'gallica', title: 'Gallica', how: 'sub', event: 'Gallica', endMs: Date.parse('2026-12-12T17:59:00Z') }];
		await runEventWatch();
	} finally {
		windows.fetchWindows = origFetch;
		windows.activeWindows = origActive;
		global.bot = saved;
	}
	assert.equal(sent.length, 2);
	assert.ok(sent.every((t) => t.startsWith('@ninou2 — @StreamDatabase: Twitch global badge now available: Gallica') && t.endsWith(' NEU') && !t.includes('ALT')));
});

test('Raid Notify: Test laeuft in echter Zeit wie ein Raid mit 120 s Countdown (ninou2, 20.11.2026)', () => {
	const { testSchedule } = require('../src/clients/modules/chat/raid-notifier.js');
	const items = [
		{ id: 3, on: true, seconds: -4, times: 1 },
		{ id: 1, on: true, seconds: 120, times: 3 },
		{ id: 2, on: true, seconds: 20, times: 3 },
		{ id: 4, on: false, seconds: 60, times: 1 },
	];
	assert.deepEqual(
		testSchedule(items).map((s) => [s.item.id, s.delayMs]),
		[
			[1, 0],
			[2, 100_000],
			[3, 124_000],
		],
	);
});
