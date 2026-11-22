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
