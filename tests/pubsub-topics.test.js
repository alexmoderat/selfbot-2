const test = require('node:test');
const assert = require('node:assert');
const { channelTopics } = require('../src/services/pubsub.js');

test('channelTopics: Mod-Topics nur mit moderator', () => {
	const mod = channelTopics('1', '2');
	const plain = channelTopics('1', '2', { moderator: false });
	assert.strictEqual(mod.length, 8);
	assert.deepStrictEqual(plain, ['video-playback-by-id.2', 'raid.2', 'broadcast-settings-update.2']);
	assert.ok(mod.includes('chat_moderator_actions.1.2'));
});
