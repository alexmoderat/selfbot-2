const test = require('node:test');
const assert = require('node:assert/strict');

const { wantedModerator } = require('../src/clients/events/USERSTATE.js');

const channel = (mode, twitchId = '1') => ({ name: 'x', mode, twitchId });

test('USERSTATE: Mod-Badge macht Write-/VIP-Channels zu Moderator-Channels', () => {
	assert.equal(wantedModerator(channel('Write'), true), true);
	assert.equal(wantedModerator(channel('VIP'), true), true);
	assert.equal(wantedModerator(channel('Moderator'), true), null);
});

test('USERSTATE: ohne Mod-Badge faellt nur ein Moderator-Channel zurueck auf Write', () => {
	assert.equal(wantedModerator(channel('Moderator'), false), false);
	assert.equal(wantedModerator(channel('Write'), false), null);
	assert.equal(wantedModerator(channel('VIP'), false), null);
});

test('USERSTATE: Read, Inactive, unbekannte und ID-lose Channels bleiben unberuehrt', () => {
	assert.equal(wantedModerator(channel('Read'), true), null);
	assert.equal(wantedModerator(channel('Inactive'), true), null);
	assert.equal(wantedModerator(channel('Write', null), true), null);
	assert.equal(wantedModerator(undefined, true), null);
});
