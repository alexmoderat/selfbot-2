const test = require('node:test');
const assert = require('node:assert/strict');
const { withTrigger } = require('../src/selfbot/util/trigger-suffix.js');

const NINOU2 = 4293;
const msg = (invocation, commandName, id = NINOU2, prefix = '!') => ({ invocation, commandName, prefix, sender: { id } });

test('ninou2 bekommt den Befehl in Klammern am Ende', () => {
	assert.equal(
		withTrigger('went live last time [they streamed 288/365; 1849h soo far this year]', msg('ll', 'lastlive')),
		'went live last time [they streamed 288/365; 1849h soo far this year] [!ll]',
	);
	assert.equal(withTrigger('hi', msg('ping', 'ping', NINOU2, '$ ')), 'hi [$ping]');
});

test('Alle anderen User bekommen nichts angehaengt', () => {
	assert.equal(withTrigger('done.', msg('hmr', 'howmanyreminders', 999)), 'done.');
	assert.equal(withTrigger('done.', { invocation: 'hmr', commandName: 'x', prefix: '!' }), 'done.');
});

test('!csi/!sic/!sci bleiben auch bei ninou2 ohne Befehl', () => {
	for (const alias of ['csi', 'sic', 'sci']) {
		assert.equal(withTrigger('the current stream infos are : /setgame A /settitle B', msg(alias, 'streaminfoschange')), 'the current stream infos are : /setgame A /settitle B');
	}
});

test('Mit Befehl bleibt alles im Nachrichtenlimit', () => {
	const text = withTrigger('x'.repeat(600), msg('hoursstreamedcategorieshistory', 'hoursstreamedcategorieshistory'), 500);
	assert.ok(text.length <= 500);
	assert.ok(text.endsWith('[!hoursstreamedcategorieshistory]'));
});
