const test = require('node:test');
const assert = require('node:assert/strict');
const { isGeneratedName, isEmoteOnly, isYoungAccount, isEmoteWave } = require('../src/misc/emote-wave.js');

const known = new Set(['DogeFace', 'Skull']);

test('isGeneratedName: Namen der Welle ja, normale/kurze nein', () => {
	for (const n of ['legal_rodina', 'horizontalrosie94', 'carleneaesthetic', 'ranasupporting', 'drunk_cassandry', 'prepared_caryl16', 'doubtful_dolli', 'recent_megan', 'supremenanci14', 'aggregate_felicdad44', 'plannedaudre', 'juicy_dawn']) {
		assert.equal(isGeneratedName(n), true, n);
	}
	for (const n of ['itsylime_', 'chick3n80y_', '8buh', 'zenisthegoat12x_', 'Xx__Dark', 'reksua']) {
		assert.equal(isGeneratedName(n), false, n);
	}
});

test('isEmoteOnly: nur Emotes (7TV-Namen oder native Bereiche), mindestens 3', () => {
	assert.equal(isEmoteOnly('DogeFace DogeFace DogeFace', '', known), true);
	assert.equal(isEmoteOnly('DogeFace Skull DogeFace', '', known), true);
	assert.equal(isEmoteOnly('DogeFace DogeFace', '', known), false); // zu kurz
	assert.equal(isEmoteOnly('DogeFace hello DogeFace Skull', '', known), false); // Wort dazwischen
	assert.equal(isEmoteOnly('Kappa Kappa Kappa', '25:0-4,6-10,12-16', new Set()), true); // native Emotes per Tag
});

test('isEmoteWave: alle drei Merkmale noetig', () => {
	const base = { text: 'DogeFace DogeFace DogeFace', emoteTag: '', knownNames: known, login: 'legal_rodina', age: { ageDays: 32 } };
	assert.equal(isEmoteWave(base), true);
	assert.equal(isEmoteWave({ ...base, age: { ageDays: 300 } }), false); // altes Konto
	assert.equal(isEmoteWave({ ...base, login: 'itsylime_' }), false); // normaler Name
	assert.equal(isEmoteWave({ ...base, text: 'hello there friend' }), false);
	assert.equal(isYoungAccount(null), false); // Alter unbekannt: nicht bannen
});
