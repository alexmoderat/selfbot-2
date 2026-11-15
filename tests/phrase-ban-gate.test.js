const test = require('node:test');
const assert = require('node:assert/strict');
const { isWeirdName, shouldBanPhraseHit } = require('../src/misc/phrase-ban-gate.js');

test('isWeirdName: generierte Spam-Namen ja, kurze normale nein', () => {
	for (const name of ['needymanagementc0ph', 'curvedbutleruzzbn6q1hc', 'ghostshaman3767', 'oliver_edd', 'weebconnect', 'luckychateauqjy032']) {
		assert.equal(isWeirdName(name), true, name);
	}
	for (const name of ['reksua', 'itsyl_', 'kickster', 'bob']) {
		assert.equal(isWeirdName(name), false, name);
	}
});

test('shouldBanPhraseHit: nur komischer Name UND juenger als 7 Tage', () => {
	assert.equal(shouldBanPhraseHit('needymanagementc0ph', { ageDays: 2 }), true);
	assert.equal(shouldBanPhraseHit('needymanagementc0ph', { ageDays: 7 }), false);
	assert.equal(shouldBanPhraseHit('reksua10', { ageDays: 950 }), false); // Reksua10: alt, nichts passiert
	assert.equal(shouldBanPhraseHit('reksua', { ageDays: 1 }), false); // normaler Name, jung: keine Aktion
	assert.equal(shouldBanPhraseHit('needymanagementc0ph', null), true); // Alter unbekannt: wie bisher
});
