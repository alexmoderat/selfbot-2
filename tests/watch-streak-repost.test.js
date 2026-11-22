const test = require('node:test');
const assert = require('node:assert/strict');

test('Watch-Streak-Repost: ninou2 und im_row1, gleiche Meldung nur einmal', () => {
	const { CHANNELS, isDuplicate } = require('../src/clients/modules/chat/watch-streak-repost.js');
	assert.ok(CHANNELS.has('ninou2') && CHANNELS.has('im_row1'));
	assert.equal(isDuplicate('zzq-id-1', 1000), false);
	assert.equal(isDuplicate('zzq-id-1', 2000), true);
	assert.equal(isDuplicate('zzq-id-1', 1000 + 11 * 60_000), false);
});
