const test = require('node:test');
const assert = require('node:assert/strict');
const { withTrigger } = require('../src/misc/trigger-suffix.js');
const { parseStreamInfosLine } = require('../src/modules/stream-infos-restore.js');

const msg = (invocation, commandName, prefix = '!') => ({ invocation, commandName, prefix });

test('Antworten enden mit dem ausloesenden Befehl', () => {
	assert.equal(withTrigger('xqc went last on november 9th [they streamed 309/365 soo far this year]', msg('ll', 'lastlive')), 'xqc went last on november 9th [they streamed 309/365 soo far this year]. "!ll"');
	assert.equal(withTrigger('done.', msg('hmr', 'howmanyreminders')), 'done. "!hmr"');
	assert.equal(withTrigger('hi', msg('ping', 'ping', '$ ')), 'hi. "$ping"');
	assert.equal(withTrigger('custom text', msg('gn', 'custom-gn')), 'custom text. "!gn"');
});

test('!csi/!sic/!sci bleiben ohne Befehl', () => {
	for (const alias of ['csi', 'sic', 'sci']) {
		assert.equal(withTrigger('the current stream infos are : /setgame A /settitle B', msg(alias, 'streaminfoschange')), 'the current stream infos are : /setgame A /settitle B');
	}
});

test('Mit Befehl bleibt alles im Nachrichtenlimit', () => {
	const text = withTrigger('x'.repeat(600), msg('hoursstreamedcategorieshistory', 'hoursstreamedcategorieshistory'), 500);
	assert.ok(text.length <= 500);
	assert.ok(text.endsWith('"!hoursstreamedcategorieshistory"'));
});

test('Zurueckkopieren einer !csi-Zeile mit Befehl am Ende: der gehoert nicht zum Titel', () => {
	assert.deepEqual(parseStreamInfosLine('the current stream infos are : /setgame Darksiders Genesis /settitle Full Playthrough part 16. "!csi"'), { game: 'Darksiders Genesis', title: 'Full Playthrough part 16' });
	assert.deepEqual(parseStreamInfosLine('/setgame Minecraft /settitle quote "hi"'), { game: 'Minecraft', title: 'quote "hi"' });
});
