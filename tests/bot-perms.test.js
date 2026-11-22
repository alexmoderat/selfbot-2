const test = require('node:test');
const assert = require('node:assert/strict');

const { botPermsMissing } = require('../src/clients/modules/handler.js');

test('botPerms: ohne Angabe oder ohne Channel keine Pruefung', () => {
	assert.equal(botPermsMissing({}, { mode: 'Write' }), null);
	assert.equal(botPermsMissing({ botPerms: ['mod'] }, null), null);
});

test('botPerms mod: nur Moderator-Channels', () => {
	assert.equal(botPermsMissing({ botPerms: ['mod'] }, { mode: 'Moderator' }), null);
	assert.equal(botPermsMissing({ botPerms: ['mod'] }, { mode: 'VIP' }), 'moderator');
	assert.equal(botPermsMissing({ botPerms: ['mod'] }, { mode: 'Write' }), 'moderator');
});

test('botPerms vip: VIP oder Moderator genuegt', () => {
	assert.equal(botPermsMissing({ botPerms: ['vip'] }, { mode: 'VIP' }), null);
	assert.equal(botPermsMissing({ botPerms: ['vip'] }, { mode: 'Moderator' }), null);
	assert.equal(botPermsMissing({ botPerms: ['vip'] }, { mode: 'Write' }), 'VIP');
});
