const test = require('node:test');
const assert = require('node:assert/strict');
const { withTrigger, formatStreamInfosChange } = require('../src/commands/streaminfoschange.js');
const { parseStreamInfosLine } = require('../src/modules/stream-infos-restore.js');

test('!csi-Antwort endet mit dem ausloesenden Befehl', () => {
	const text = withTrigger(formatStreamInfosChange('Darksiders Genesis', 'Full Playthrough part 16'), { invocation: 'csi', prefix: '!' });
	assert.equal(text, 'the current stream infos are : /setgame Darksiders Genesis /settitle Full Playthrough part 16. "!csi"');
});

test('Zurueckkopieren: die Endung gehoert nicht zum Titel', () => {
	assert.deepEqual(parseStreamInfosLine('the current stream infos are : /setgame Darksiders Genesis /settitle Full Playthrough part 16. "!csi"'), { game: 'Darksiders Genesis', title: 'Full Playthrough part 16' });
	assert.deepEqual(parseStreamInfosLine('stream infos are : /setgame Minecraft /settitle chill. "!sic"'), { game: 'Minecraft', title: 'chill' });
	assert.deepEqual(parseStreamInfosLine('/setgame Minecraft /settitle chill.. "!csi"'), { game: 'Minecraft', title: 'chill.' });
	assert.deepEqual(parseStreamInfosLine('/setgame Minecraft /settitle quote "hi"'), { game: 'Minecraft', title: 'quote "hi"' });
});
