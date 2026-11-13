const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { formatStreamInfosChange, formatSavedStreamInfos, parseSaveArgs } = require('../src/commands/streaminfoschange.js');
const { parseStreamInfosLine } = require('../src/modules/stream-infos-restore.js');

test('!csi2: Antwort mit !setgame/!settitle, !csi bleibt bei /setgame', () => {
	assert.equal(formatStreamInfosChange('Remnant', 'Part 01', true), 'the current stream infos are : !setgame Remnant !settitle Part 01');
	assert.equal(formatStreamInfosChange('Remnant', 'Part 01'), 'the current stream infos are : /setgame Remnant /settitle Part 01');
	assert.equal(formatSavedStreamInfos('A', 'B', true), 'stream infos are : !setgame A !settitle B');
});

test('Einfuegen: Modul erkennt die Bang-Zeile nur mit Vorspann, ohne ist es ein Befehl', () => {
	const line = '!setgame Remnant: From the Ashes !settitle Remnant: From the Ashes ,Subject 2923 part 01';
	assert.deepEqual(parseStreamInfosLine(`the current stream infos are : ${line}`), {
		game: 'Remnant: From the Ashes',
		title: 'Remnant: From the Ashes ,Subject 2923 part 01',
	});
	assert.equal(parseStreamInfosLine(line), null);
	assert.deepEqual(parseStreamInfosLine(line, { bare: true })?.game, 'Remnant: From the Ashes');
	assert.deepEqual(parseStreamInfosLine('the current stream infos are : /setgame A /settitle B'), { game: 'A', title: 'B' });
});

test('csi2 save: Bang-Zeile mit Platz in Anfuehrungszeichen', () => {
	assert.deepEqual(parseSaveArgs(['!setgame', 'A', '!settitle', 'B', '"1"']), { slot: '1', infos: { game: 'A', title: 'B' } });
});
