const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

global.bot = { Channels: { isLive: () => null } };
const Filter = require('../src/util/filter.js');

const make = (data) =>
	Filter.fromDoc({
		_id: data.id ?? 1,
		userId: null,
		channelId: null,
		command: null,
		invocation: null,
		type: 'Blacklist',
		response: 'Auto',
		active: true,
		data: null,
		...data,
	});

const user = { id: 10, name: 'tester', data: {} };
const admin = { id: 11, name: 'admin', data: { administrator: true } };
const command = { name: 'ping', flags: [], whitelistResponse: null };

describe('Filter-Daten', () => {
	it('Cooldown: multiplier und override', () => {
		assert.equal(Filter.applyData(make({ type: 'Cooldown', data: '{"multiplier":2}' }), 3000), 6000);
		assert.equal(Filter.applyData(make({ type: 'Cooldown', data: '{"override":1000}' }), 3000), 1000);
		assert.equal(Filter.applyData(make({ type: 'Cooldown', data: '{"override":5000,"respect":false}' }), 3000), 5000);
	});

	it('Arguments: string an Position, regex in Bereich', () => {
		const byIndex = make({ type: 'Arguments', data: '{"args":[{"string":"bad","index":0}]}' });
		assert.equal(Filter.applyData(byIndex, ['bad', 'x']), true);
		assert.equal(Filter.applyData(byIndex, ['x', 'bad']), false);
		const byRange = make({ type: 'Arguments', data: '{"args":[{"regex":"/^b/i","range":"1..2"}]}' });
		assert.equal(Filter.applyData(byRange, ['b', 'Bx']), true);
		assert.equal(Filter.applyData(byRange, ['b', 'x']), false);
	});

	it('Auto-Antworten der Blacklist', () => {
		assert.equal(Filter.getBlacklistAutoReply({ channelId: 1, command: 'ping' }), 'This command cannot be executed in this channel.');
		assert.equal(Filter.getBlacklistAutoReply({ userId: 1 }), 'You cannot execute any commands in any channel.');
	});
});

describe('Filter.execute', () => {
	beforeEach(() => Filter._filters.clear());

	const add = (data) => {
		const filter = make(data);
		Filter._filters.set(filter.id, filter);
		return filter;
	};

	it('Blacklist fuer den Channel greift, Administratoren sind ausgenommen', async () => {
		add({ id: 1, channelId: 5, command: 'ping' });
		const blocked = await Filter.execute({ user, command, invocation: 'ping', channel: { id: 5 }, args: [] });
		assert.equal(blocked.success, false);
		assert.equal(blocked.reply, 'This command cannot be executed in this channel.');

		assert.equal((await Filter.execute({ user, command, invocation: 'ping', channel: { id: 6 }, args: [] })).success, true);
		assert.equal((await Filter.execute({ user: admin, command, invocation: 'ping', channel: { id: 5 }, args: [] })).success, true);
	});

	it('inaktive Filter zaehlen nicht, Whitelist-Commands brauchen einen Eintrag', async () => {
		add({ id: 2, channelId: 5, active: false });
		assert.equal((await Filter.execute({ user, command, invocation: 'ping', channel: { id: 5 }, args: [] })).success, true);

		const whitelisted = { ...command, flags: ['whitelist'] };
		assert.equal((await Filter.execute({ user, command: whitelisted, invocation: 'ping', channel: null, args: [] })).reason, 'whitelist');
		add({ id: 3, type: 'Whitelist', userId: user.id, command: 'ping' });
		assert.equal((await Filter.execute({ user, command: whitelisted, invocation: 'ping', channel: null, args: [] })).success, true);
	});

	it('Cooldown-Filter mit der hoechsten Prioritaet gewinnt', () => {
		add({ id: 4, type: 'Cooldown', data: '{"multiplier":2}' });
		add({ id: 5, type: 'Cooldown', command: 'ping', userId: user.id, data: '{"multiplier":3}' });
		assert.equal(Filter.getCooldownModifiers({ user, command, invocation: 'ping', channel: null }).id, 5);
	});
});
