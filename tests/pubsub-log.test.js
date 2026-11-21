const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { describe: line } = require('../src/selfbot/util/pubsub-log.js');

describe('PubSub-Logzeilen im Wortlaut von Donts pubSubHandler', () => {
	it('stream-up und stream-down', () => {
		assert.deepEqual(line('video-playback-by-id', { type: 'stream-up' }, 'ninou2'), { level: 'info', text: 'ninou2 went live!' });
		assert.deepEqual(line('video-playback-by-id', { type: 'stream-down' }, 'ninou2'), { level: 'info', text: 'ninou2 went offline!' });
	});
	it('viewcount ist kein Logeintrag', () => {
		assert.equal(line('video-playback-by-id', { type: 'viewcount', viewers: 3 }, 'ninou2'), null);
	});
	it('Titel- und Game-Wechsel', () => {
		const payload = { type: 'broadcast_settings_update', channel: 'ninou2', game: 'Chess', game_id: '2', old_game_id: '1', status: 'neu', old_status: 'alt' };
		assert.equal(line('broadcast-settings-update', payload, 'ninou2').text, 'ninou2 changed to new game: Chess | ninou2 changed to new title: neu');
		assert.equal(line('broadcast-settings-update', { ...payload, game_id: '1', status: 'alt' }, 'ninou2'), null);
	});
	it('Moderationsaktion: Ban/Timeout als WARN mit Duration', () => {
		const ban = line('chatrooms-user-v1', { type: 'user_moderation_action', data: { action: 'ban' } }, 'alexmoderat');
		assert.deepEqual(ban, { level: 'warn', text: 'alexmoderat BAN Duration: false' });
		const timeout = line('chatrooms-user-v1', { type: 'user_moderation_action', data: { action: 'timeout', expires_in_ms: 60000 } }, 'alexmoderat');
		assert.equal(timeout.level, 'warn');
		assert.match(timeout.text, /^alexmoderat TIMEOUT Duration: 1m$/);
		assert.equal(line('chatrooms-user-v1', { type: 'user_moderation_action', data: { action: 'unban' } }, 'a').level, 'info');
	});
	it('Nachricht ohne type: Fehlertext wie bei Dont', () => {
		assert.deepEqual(line('broadcast-settings-update', { x: 1 }, 'a'), { level: 'error', text: 'Unknown message without type: {"x":1}' });
	});
	it('andere Topics bleiben ohne Zeile', () => {
		assert.equal(line('hype-train-events-v1', { type: 'x' }, 'a'), null);
	});
});
