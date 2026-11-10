const test = require('node:test');
const assert = require('node:assert/strict');
const { getHiddenDomains, getMessageDomains } = require('../src/misc/text-analysis.js');
const { matchDomains } = require('../src/services/spam-domains.js');

// Vorfall #pearsbott, 10.11.2026 und 02.11.2026
const VIPERDRAGON = 'Netflix has competition. Have you checked out d       o        v        i        e .tv yet? 👀 SwiftRage PogU';
const VOIDDRUID = "Don't let your watchlist get boring. Check out dovie .tv LULW";

test('versteckte Links werden erkannt', () => {
	assert.deepEqual(getHiddenDomains(VIPERDRAGON), ['dovie.tv']);
	assert.deepEqual(getHiddenDomains(VOIDDRUID), ['dovie.tv']);
	assert.deepEqual(getHiddenDomains('visit zzqsite (dot) com'), ['zzqsite.com']);
	assert.deepEqual(getHiddenDomains('z z q s i t e . c o m'), ['zzqsite.com']);
	assert.deepEqual(getHiddenDomains('go to z z q x .ru'), ['zzqx.ru']);
});

test('offene Links, Allowlist und normale Saetze sind nicht versteckt', () => {
	assert.deepEqual(getHiddenDomains('zzqsite.com is cool'), []);
	assert.deepEqual(getHiddenDomains('ok. live soon gg. top'), []);
	assert.deepEqual(getHiddenDomains('lol hi. com'), []);
	assert.deepEqual(getHiddenDomains('nice .gg'), []);
	assert.deepEqual(getHiddenDomains('haha x d .com'), []);
	assert.deepEqual(getHiddenDomains('i am at twitch .tv/zzq'), []);
	assert.deepEqual(getHiddenDomains('join d i s c o r d .gg/zzq'), []);
	assert.deepEqual(getHiddenDomains('a b c and I. Love. You'), []);
	// kick.com ausgenommen (frueherer Fehlalarm)
	assert.deepEqual(getHiddenDomains('watch me on kick .com/zzq'), []);
	assert.deepEqual(getMessageDomains('k i c k .com/zzq and kick.com/zzq'), []);
});

test('getMessageDomains findet offene und versteckte Schreibweisen', () => {
	assert.deepEqual(getMessageDomains('check zzqsite.com'), ['zzqsite.com']);
	assert.deepEqual(getMessageDomains(VIPERDRAGON), ['dovie.tv']);
	assert.deepEqual(getMessageDomains('zzqsite. com'), ['zzqsite.com']);
	assert.deepEqual(getMessageDomains('youtube.com/watch?v=zzq'), []);
});

test('gelernte Domains greifen auch als Subdomain', () => {
	const known = new Set(['dovie.tv']);
	assert.equal(matchDomains(['dovie.tv'], known), 'dovie.tv');
	assert.equal(matchDomains(['www2.dovie.tv'], known), 'dovie.tv');
	assert.equal(matchDomains(['notdovie.tv'], known), null);
	assert.equal(matchDomains(['tv'], known), null);
});
