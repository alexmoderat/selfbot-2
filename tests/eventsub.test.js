const test = require('node:test');
const assert = require('node:assert');

const dispatched = [];
const channels = { 111: { name: 'foo', twitchId: '111', mode: 'Moderator' } };
global.bot = {
	Config: { onlyChannels: [] },
	Twitch: { selfId: '999' },
	Channels: { getByTwitchId: (id) => channels[id] ?? null },
	ChatModules: { dispatch: (event, context) => dispatched.push({ event, context }) },
};

const { wantsChannel } = require('../src/util/twitch/eventSub.js');
const eventSubEvents = require('../src/util/twitch/eventSubEvents.js');

test('wantsChannel: Follows nur mit Mod-Rechten, eigener Channel immer', () => {
	assert.strictEqual(wantsChannel({ name: 'a', twitchId: '1', mode: 'Moderator' }), true);
	assert.strictEqual(wantsChannel({ name: 'a', twitchId: '1', mode: 'Write' }), false);
	assert.strictEqual(wantsChannel({ name: 'a', twitchId: null, mode: 'Moderator' }), false);
	assert.strictEqual(wantsChannel({ name: 'self', twitchId: '999', mode: 'Write' }), true);
	assert.strictEqual(wantsChannel({ name: 'self', twitchId: '999', mode: 'Inactive' }), false);
});

test('wantsChannel: Parallelbetrieb nur bediente Channels', () => {
	bot.Config.onlyChannels = ['b'];
	assert.strictEqual(wantsChannel({ name: 'a', twitchId: '1', mode: 'Moderator' }), false);
	assert.strictEqual(wantsChannel({ name: 'b', twitchId: '2', mode: 'Moderator' }), true);
	bot.Config.onlyChannels = [];
});

test('channel.follow -> follow-Event mit den Feldern des alten selfbot', () => {
	dispatched.length = 0;
	eventSubEvents['channel.follow']({
		user_id: 42,
		user_login: 'NewGuy',
		user_name: 'NewGuy',
		broadcaster_user_id: '111',
		followed_at: '2026-11-10T12:00:00Z',
	});
	eventSubEvents['channel.follow']({ user_id: 1, user_login: 'x', user_name: 'x', broadcaster_user_id: '222' });

	assert.strictEqual(dispatched.length, 1);
	assert.deepStrictEqual(dispatched[0], {
		event: 'follow',
		context: { channel: channels[111], userId: '42', userName: 'newguy', userDisplayName: 'NewGuy', followedAt: '2026-11-10T12:00:00Z' },
	});
});
