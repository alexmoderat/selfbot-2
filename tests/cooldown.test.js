const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const { CooldownManager } = require('../src/clients/modules/cooldown.js');
const { effectiveLevel, applyLevel, isLevelAllowed, parseLevel } = require('../src/clients/modules/levels.js');

describe('CooldownManager', () => {
	it('blockiert innerhalb des Cooldowns und gibt danach frei', () => {
		const manager = new CooldownManager();
		manager.set(1, 5, 'ping', 3000, 1000);
		assert.equal(manager.check(1, 5, 'ping', false, 2000), false);
		assert.equal(manager.check(1, 5, 'ping', false, 4000), true);
	});

	it('trennt Channel, User und Command; PMs (null) sind ein eigener Channel', () => {
		const manager = new CooldownManager();
		manager.set(1, 5, 'ping', 3000, 1000);
		assert.equal(manager.check(2, 5, 'ping', false, 2000), true);
		assert.equal(manager.check(1, 6, 'ping', false, 2000), true);
		assert.equal(manager.check(1, 5, 'roll', false, 2000), true);
		manager.set(null, 7, 'ping', 3000, 1000);
		assert.equal(manager.check(null, 7, 'ping', false, 2000), false);
		assert.equal(manager.check(1, 7, 'ping', false, 2000), true);
	});

	it('pending sperrt alle Commands des Users, bis es aufgehoben wird oder ablaeuft', () => {
		const manager = new CooldownManager(10_000);
		manager.setPending(5, 'busy', 1000);
		assert.equal(manager.check(1, 5, 'roll', false, 2000), false);
		assert.equal(manager.check(1, 5, 'roll', true, 2000), true, 'skipPending ignoriert die Sperre');
		assert.equal(manager.check(1, 5, 'roll', false, 12_000), true, 'laeuft nach dem Timeout ab');
		manager.setPending(5, 'busy', 20_000);
		manager.unsetPending(5);
		assert.equal(manager.check(1, 5, 'roll', false, 20_001), true);
	});

	it('ignoriert Cooldowns <= 0 und meldet die Restzeit', () => {
		const manager = new CooldownManager();
		manager.set(1, 5, 'ping', 0, 1000);
		assert.equal(manager.check(1, 5, 'ping', false, 1000), true);
		manager.set(1, 5, 'ping', 2500, 1000);
		assert.deepEqual(manager.remaining(1, 5, 'ping', 1100), { seconds: 3, until: 3500 });
		assert.equal(manager.remaining(1, 5, 'ping', 4000), 0);
	});
});

const perms = (p) => ({ administrator: false, channelOwner: false, moderator: false, ...p });

test('levels: Channel kann nur strenger stellen (ninou2, 29.10.2026)', () => {
	assert.equal(effectiveLevel('everyone', 'streamer'), 'streamer');
	assert.equal(effectiveLevel('mod', 'mod'), 'mod');
	assert.equal(effectiveLevel('mod', null), 'mod');
	assert.equal(applyLevel({}, 'pyramid', 'mod', 'everyone'), null);
	assert.deepEqual(applyLevel({}, 'pyramid', 'mod', 'streamer'), { pyramid: 'streamer' });
	assert.deepEqual(applyLevel({ pyramid: 'streamer' }, 'pyramid', 'mod', 'mod'), {});
	assert.deepEqual(applyLevel({ tf: 'mod' }, 'tf', 'everyone', 'everyone'), {});
});

test('levels: wer darf', () => {
	assert.equal(isLevelAllowed(perms({}), 'everyone'), true);
	assert.equal(isLevelAllowed(perms({ moderator: true }), 'mod'), true);
	assert.equal(isLevelAllowed(perms({ moderator: true }), 'streamer'), false);
	assert.equal(isLevelAllowed(perms({ channelOwner: true }), 'streamer'), true);
	assert.equal(isLevelAllowed(perms({ administrator: true }), 'streamer'), true);
});

test('levels: Eingaben', () => {
	assert.equal(parseLevel('anyone'), 'everyone');
	assert.equal(parseLevel('Mods'), 'mod');
	assert.equal(parseLevel('streamer'), 'streamer');
	assert.equal(parseLevel('zzq'), null);
});
