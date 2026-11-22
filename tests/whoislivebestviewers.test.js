const test = require('node:test');
const assert = require('node:assert/strict');
const { viewersHead, formatViewerList } = require('../src/selfbot/commands/whoislivebestviewers.js');

test('Viewer-Rekord-Satz wie !wilb (ninou2, 22.11.2026: "!wilbv")', () => {
	assert.equal(
		viewersHead({ Value: 614, Achieved: new Date('2026-11-22T14:10:19Z') }),
		'the most total viewers of the channels with the bot that were live at one time was recorded on the 22nd november 2026 at 14:10 UTC with [614 viewers]',
	);
	assert.deepEqual(formatViewerList([{ login: 'livebadge', viewers: 300 }, { login: 'ninou2', viewers: 12 }]), ['@livebadge [300]', '@ninou2 [12]']);
});

test('Cron live-record speichert die Gesamt-Viewer mit Channels, meiste zuerst', async () => {
	const statsPath = require.resolve('../src/selfbot/util/channel-stats.js');
	const wilPath = require.resolve('../src/selfbot/commands/whoislive.js');
	const saved = [];
	require(wilPath);
	const realStats = require(statsPath);
	const realFetch = require.cache[wilPath].exports.fetchLiveStreams;
	const realUpdate = realStats.updateRecordIfHigher;
	realStats.updateRecordIfHigher = async (...args) => (saved.push(args), true);
	require.cache[wilPath].exports.fetchLiveStreams = async () => [
		{ login: 'b', viewers: 20 },
		{ login: 'a', viewers: 300 },
	];
	global.bot = { Channels: { getJoinable: () => [{ twitchId: '1' }, { twitchId: '2' }, {}] } };
	try {
		delete require.cache[require.resolve('../src/selfbot/clients/modules/crons/live-record.js')];
		const { recordLiveViewers } = require('../src/selfbot/clients/modules/crons/live-record.js');
		await recordLiveViewers();
	} finally {
		realStats.updateRecordIfHigher = realUpdate;
		require.cache[wilPath].exports.fetchLiveStreams = realFetch;
	}
	assert.deepEqual(saved, [['live_viewers', 320, [{ login: 'a', viewers: 300 }, { login: 'b', viewers: 20 }]]]);
});

test('Lange Viewer-Liste: mehrere Nachrichten statt Link, keine ueber dem Limit, kein Eintrag zerschnitten', () => {
	const { chunkMessages } = require('../src/selfbot/util/list-reply.js');
	const items = Array.from({ length: 40 }, (_, i) => `@channel_number_${i} [${100 - i}]`);
	const messages = chunkMessages('@ninou2, head : ', items, ' // ', 480);
	assert.ok(messages.length > 1);
	assert.ok(messages.every((m) => m.length <= 480));
	assert.ok(messages[0].startsWith('@ninou2, head : @channel_number_0 [100]'));
	assert.deepEqual(messages.join(' // ').replace('@ninou2, head : ', '').split(' // '), items);
	assert.deepEqual(chunkMessages('h : ', ['@a [1]', '@b [2]'], ' // ', 480), ['h : @a [1] // @b [2]']);
});
