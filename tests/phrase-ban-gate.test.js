const test = require('node:test');
const assert = require('node:assert/strict');
const { isWeirdName, isGeneratedBotName, isViewbotPhrase, shouldBanPhraseHit } = require('../src/misc/phrase-ban-gate.js');

test('isWeirdName: generierte Spam-Namen ja, kurze normale nein', () => {
	for (const name of ['needymanagementc0ph', 'curvedbutleruzzbn6q1hc', 'ghostshaman3767', 'oliver_edd', 'weebconnect', 'luckychateauqjy032']) {
		assert.equal(isWeirdName(name), true, name);
	}
	for (const name of ['reksua', 'itsyl_', 'kickster', 'bob']) {
		assert.equal(isWeirdName(name), false, name);
	}
});

test('shouldBanPhraseHit: nur komischer Name UND juenger als 7 Tage', () => {
	assert.equal(shouldBanPhraseHit('ghostshaman3767', { ageDays: 2 }), true);
	assert.equal(shouldBanPhraseHit('ghostshaman3767', { ageDays: 7 }), false);
	assert.equal(shouldBanPhraseHit('reksua10', { ageDays: 950 }), false); // Reksua10: alt, nichts passiert
	assert.equal(shouldBanPhraseHit('reksua', { ageDays: 1 }), false); // normaler Name, jung: keine Aktion
	assert.equal(shouldBanPhraseHit('ghostshaman3767', null), true); // Alter unbekannt: wie bisher
});

test('isGeneratedBotName: lange Zufallsnamen ja, normale und Unterstrich-Namen nein', () => {
	for (const name of ['vindictiveordinanceomvs', 'angelicbacklogpkdh4', 'reportedquintetdbnwd7uxsb', 'traumaticmailmannuysxa', 'promisedgroundingiyj']) {
		assert.equal(isGeneratedBotName(name), true, name);
	}
	for (const name of ['jacke245_again', 'rl_rager', 'reksua10', 'alexmoderatmod1', 'very_long_name_with_underscores']) {
		assert.equal(isGeneratedBotName(name), false, name);
	}
});

test('shouldBanPhraseHit: generierter Bot-Name wird unabhaengig vom Alter gebannt', () => {
	assert.equal(shouldBanPhraseHit('vindictiveordinanceomvs', { ageDays: 18 }), true);
	assert.equal(shouldBanPhraseHit('vindictiveordinanceomvs', { ageDays: 900 }), true);
	assert.equal(shouldBanPhraseHit('jacke245_again', { ageDays: 947 }), false);
});

test('Viewbot-Phrase: komischer Name reicht, ohne Altersgrenze (fleetingax12h, 19.11.2026)', () => {
	assert.equal(isViewbotPhrase({ Reason: 'Viewbot Services', Preset: null }), true);
	assert.equal(isViewbotPhrase({ Reason: 'Viewbot Service', Preset: null }), true);
	assert.equal(isViewbotPhrase({ Reason: 'seller bot', Preset: null }), true);
	assert.equal(isViewbotPhrase({ Reason: 'Harassment', Preset: 2 }, 2), true); // sellerbot-Preset
	assert.equal(isViewbotPhrase({ Reason: 'Harassment', Preset: null }, 2), false);
	assert.equal(isViewbotPhrase(null), false);

	assert.equal(shouldBanPhraseHit('fleetingax12h', { ageDays: 20 }, true), true);
	assert.equal(shouldBanPhraseHit('cut_rateredistribution8', { ageDays: 400 }, true), true);
	assert.equal(shouldBanPhraseHit('fleetingax12h', { ageDays: 20 }, false), false); // andere Phrasen: weiter 7 Tage
	assert.equal(shouldBanPhraseHit('reksua', { ageDays: 1 }, true), false); // normaler Name: weiter keine Aktion
});
