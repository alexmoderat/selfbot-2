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
