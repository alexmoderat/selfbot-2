const test = require('node:test');
const assert = require('node:assert/strict');

const { totalViewers } = require('../src/selfbot/commands/whoislive.js');

test('whoislive: Gesamt-Viewer aller Live-Channels (ninou2, 21.11.2026)', () => {
	assert.equal(totalViewers([{ viewers: 100 }, { viewers: 67 }, {}]), ' --- TOTAL Viewers : [167]');
});
