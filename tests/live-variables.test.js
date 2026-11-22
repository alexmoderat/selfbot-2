const test = require('node:test');
const assert = require('node:assert/strict');

const lv = require('../src/selfbot/util/live-variables.js');
const { splitMessages } = require('../src/selfbot/util/custom-commands.js');

test('Rekord-Datum "the 19th november 2026 at 20:30 UTC" (ninou2, 19.11.2026)', () => {
	assert.equal(lv.formatRecordDate('2026-11-19T20:30:00.000Z'), 'the 19th november 2026 at 20:30 UTC');
	assert.equal(lv.formatRecordDate('2026-01-01T00:00:00.000Z'), 'the 1st january 2026 at 00:00 UTC');
	assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(lv.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
});

test('Live-Liste: laengste zuerst, Stunden bzw. Minuten', () => {
	const now = Date.parse('2026-11-22T12:00:00Z');
	const list = lv.formatLiveList(
		[
			{ login: 'b', startedAt: '2026-11-22T11:45:00Z' },
			{ login: 'a', startedAt: '2026-11-22T08:30:00Z' },
		],
		now,
	);
	assert.deepEqual(list, ['@a [3h]', '@b [15m]']);
});

test('resolveVariables: Wil-Text wie der alte !wil, Rekord-Variablen, unbekannte bleiben stehen', async () => {
	const stats = require('../src/selfbot/util/channel-stats.js');
	const realGet = stats.getRecord;
	stats.getRecord = async (name) =>
		name === 'live_channels'
			? { Value: 18, Achieved: new Date('2026-11-19T20:45:09Z'), Channels: ['zed', 'abe'] }
			: {
					Value: 614,
					Achieved: new Date('2026-11-22T14:10:19Z'),
					Channels: [
						{ login: 'a', viewers: 300 },
						{ login: 'b', viewers: 12 },
					],
				};
	global.bot = { Channels: { getJoinable: () => [] } };
	try {
		const out = await lv.resolveVariables('[{record_count}] {record_date} : {record_channels} | {viewers_record} {viewers_record_channels} {unknown}');
		assert.equal(out, '[18] the 19th november 2026 at 20:45 UTC : @abe @zed | 614 @a [300] // @b [12] {unknown}');
	} finally {
		stats.getRecord = realGet;
		delete global.bot;
	}
});

test('Custom Command: lange Antwort auf mehrere Nachrichten, an " // " getrennt, nichts zerschnitten', () => {
	assert.deepEqual(splitMessages('kurz'), ['kurz']);
	const items = Array.from({ length: 40 }, (_, i) => `@channel_number_${i} [${100 - i}]`);
	const messages = splitMessages(`@ninou2, head : ${items.join(' // ')}`);
	assert.ok(messages.length > 1 && messages.every((m) => m.length <= 480));
	assert.deepEqual(messages.join(' // ').replace('@ninou2, head : ', '').split(' // '), items);
});

test('Cron live-record speichert die Gesamt-Viewer mit Channels, meiste zuerst', async () => {
	const stats = require('../src/selfbot/util/channel-stats.js');
	const saved = [];
	const realUpdate = stats.updateRecordIfHigher;
	const realFetch = lv.fetchLiveStreams;
	stats.updateRecordIfHigher = async (...args) => (saved.push(args), true);
	lv.fetchLiveStreams = async () => [
		{ login: 'b', viewers: 20 },
		{ login: 'a', viewers: 300 },
	];
	global.bot = { Channels: { getJoinable: () => [{ twitchId: '1' }, { twitchId: '2' }, {}] } };
	try {
		delete require.cache[require.resolve('../src/selfbot/clients/modules/crons/live-record.js')];
		await require('../src/selfbot/clients/modules/crons/live-record.js').recordLiveViewers();
	} finally {
		stats.updateRecordIfHigher = realUpdate;
		lv.fetchLiveStreams = realFetch;
		delete global.bot;
	}
	assert.deepEqual(saved, [
		[
			'live_viewers',
			320,
			[
				{ login: 'a', viewers: 300 },
				{ login: 'b', viewers: 20 },
			],
		],
	]);
});

test('Variablen {arg1}/{args}/{bot_url}', async () => {
	process.env.WEB_BASE_URL = 'https://bot.example/';
	assert.equal(await lv.resolveVariables('{arg1}|{arg2}|{args}|{bot_url}/dashboard|{ARG1}', ['@Ninou2', 'x']), 'ninou2|x|@Ninou2 x|https://bot.example/dashboard|ninou2');
	assert.equal(await lv.resolveVariables('[{arg1}]'), '[]');
});

test('Bedingungen {if}/{else}, verschachtelt, = und !=; Werte werden nie als Vorlage gelesen', async () => {
	const t = (s) => lv.resolveVariables(s, ['@Foo']);
	assert.equal(await t('{if arg1}da{else}leer{/if}'), 'da');
	assert.equal(await t('{if arg1=foo}a{else}b{/if}|{if arg1!=foo}a{else}b{/if}'), 'a|b');
	assert.equal(await t('{if arg2}x{/if}-{if arg1}{if arg2}1{else}2{/if}{/if}'), '-2');
});

test('Stream-Infos: live, offline, nicht gefunden, Fehler; Titel mit "{if" bleibt Text', async () => {
	const si = require('../src/selfbot/util/stream-info.js');
	const real = si.getStreamInfo;
	const tpl =
		'{if si_kind=live}L {si_name} {si_viewers} {si_title}{if si_bitrate} {si_bitrate}k{/if}{/if}{if si_kind=offline}O {si_offline}{if si_last_title} t:{si_last_title}{/if}{/if}{if si_kind=notfound}N {si_target}{/if}{if si_kind=error}E {si_error}{/if}';
	const run = async (impl) => {
		si.getStreamInfo = impl;
		try {
			return await lv.resolveVariables(tpl, ['Foo'], { channel: 'chan' });
		} finally {
			si.getStreamInfo = real;
		}
	};
	assert.equal(await run(async () => ({ live: true, displayName: 'Foo', viewers: 5, title: 'x {if arg1}y{/if}', hls: { bitrate: 6000 } })), 'L Foo 5 x {if arg1}y{/if} 6000k');
	assert.equal(await run(async () => ({ live: false, displayName: 'Foo', offlineSince: '2h', lastTitle: 'T' })), 'O 2h t:T');
	assert.equal(await run(async () => null), 'N foo');
	assert.equal(await run(async () => Promise.reject(new Error('boom'))), 'E boom');
});

test('!ll: Standardvorlage mit gestubbten Daten (live, notfound, multi)', async () => {
	const ld = require('../src/selfbot/util/lastlive-data.js');
	const real = ld.getLastLive;
	const render = async (data) => {
		ld.getLastLive = async () => data;
		try {
			return await lv.resolveVariables(ld.DEFAULT_TEMPLATE.replace('{user}', '@ninou2'), [], { channel: 'x' });
		} finally {
			ld.getLastLive = real;
		}
	};
	assert.equal(await render({ kind: 'notfound', channel: 'zzz' }), '@ninou2, no Twitch account named "zzz" exists.');
	assert.equal(
		await render({
			kind: 'live',
			channel: 'xqc',
			start: '15:00',
			length: '1h 2m',
			prev: ', Last live before this current stream was on A (1 day ago)',
			year: ' [they streamed 1/365 soo far this year]',
		}),
		'@ninou2, @xqc is live right now [15:00 UTC to now, ⏱1h 2m], Last live before this current stream was on A (1 day ago) [they streamed 1/365 soo far this year]',
	);
	assert.equal(await render({ kind: 'live', channel: 'xqc' }), '@ninou2, @xqc is live right now.');
	assert.equal(await render({ kind: 'none', own: '#xqc' }), '@ninou2, no stream found for #xqc (no VODs, never streamed as far as Twitch knows, and it is not tracked).');
	assert.equal(
		await render({ kind: 'multi', channel: 'a', date: 'D', count: '2', sessions: 'S1 , S2', total: '3h', dayword: 'today', year: '' }),
		'@ninou2, @a went live last time on D for "2" times : S1 , S2 , THEY streamed for a total of 3h today.',
	);
	assert.equal(await render({ kind: 'single', channel: 'a', when: 'W', ago: '2 days ago', year: ' [y]' }), '@ninou2, @a went live last time on W (2 days ago) [y]');
});

test('user: Vorlagen fuer notfound, banned, ok (detailliert und kompakt) mit gestubbtem GQL', async () => {
	const gql = require('../src/selfbot/token/gql.js');
	const real = { p: gql.getUserProfile, a: gql.isUsernameAvailable, r: gql.getChatRestrictedReasons };
	gql.isUsernameAvailable = async () => true;
	gql.getChatRestrictedReasons = async () => ['CHANNEL_HAS_CONSEQUENCE'];
	const tpl =
		'{if u_kind=notfound}nf {u_login}{u_available}{/if}{if u_kind=banned}b {u_name} {u_ban_type}{/if}{if u_kind=ok}{if u_restricted}W {/if}{u_display}: {u_login} {u_id} {u_roles}|{u_roles_c}{u_followers} {u_bio}|{u_bio_c}{/if}';
	const run = async (profile, arg) => {
		gql.getUserProfile = async () => profile;
		try {
			return await lv.resolveVariables(tpl, [arg], { channel: 'x' });
		} finally {
			Object.assign(gql, { getUserProfile: real.p });
		}
	};
	try {
		assert.equal(await run(null, 'Nobody'), 'nf nobody · name is available!');
		assert.equal(await run({ banned: true, banReason: 'TOS_INDEFINITE', id: '5', login: 'bad', displayName: 'Bad' }, 'bad'), 'b Bad indefinite');
		assert.equal(
			await run({ id: '7', login: 'xqc', displayName: 'xQc', roles: { isPartner: true }, followers: 1234, bio: '  hi   there ' }, 'xqc'),
			'W xQc: xqc 7 Partner|partner · followers: 1,234 hi there|hi there',
		);
	} finally {
		Object.assign(gql, { getUserProfile: real.p, isUsernameAvailable: real.a, getChatRestrictedReasons: real.r });
	}
});

test('viewerstreak/stalk: Variablen mit gestubbten Daten, Flags des Custom-stalk', async () => {
	const vsm = require('../src/selfbot/util/viewerstreak-data.js');
	const sm = require('../src/selfbot/util/stalk-data.js');
	const real = { v: vsm.getViewerStreak, s: sm.getStalk };
	const calls = [];
	vsm.getViewerStreak = async (input) => (calls.push(input), { kind: 'ok', login: 'foo', channel: 'ninou2', value: '12', seen: 'the 6th october 2026', best: ' [best]' });
	sm.getStalk = async (input) => (calls.push(input), { kind: 'ok', who: 'That user was', ago: '5m ago', channel: '#ninou2', text: 'hi {if x}' });
	try {
		const ctx = { channel: 'ninou2', twitchId: '42', sender: { name: 'me' }, msg: { m: 1 } };
		assert.equal(await lv.resolveVariables('{if vs_kind=ok}{vs_login} > {vs_value} < ({vs_seen}){vs_best}{/if}', ['Foo'], ctx), 'foo > 12 < (the 6th october 2026) [best]');
		assert.deepEqual(calls[0], { userRaw: 'Foo', channelName: 'ninou2', channelId: '42', senderName: 'me' });
		assert.equal(
			await lv.resolveVariables('{if s_kind=ok}{s_who} last seen in chat {s_ago} ({s_channel}) Last message: {s_text}{/if}', ['@Foo'], ctx),
			'That user was last seen in chat 5m ago (#ninou2) Last message: hi {if x}',
		);
		assert.deepEqual(calls[1], { userRaw: 'Foo', msg: ctx.msg, hasChannel: true });
	} finally {
		vsm.getViewerStreak = real.v;
		sm.getStalk = real.s;
	}
});
