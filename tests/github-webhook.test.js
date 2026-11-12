const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
global.bot = global.bot ?? {};
const { formatGithubEvent } = require('../src/misc/github-events.js');
const { validSignature, isDuplicate } = require('../src/api/routes-github.js');

const base = { repository: { full_name: 'a/b' }, sender: { login: 'u' } };

test('Texte: Stern, Fork, Issue; Rest bleibt still', () => {
	assert.equal(formatGithubEvent('star', { ...base, action: 'created' }), "⭐ New star on 'a/b' by u");
	assert.equal(formatGithubEvent('star', { ...base, action: 'deleted' }), null);
	assert.match(formatGithubEvent('fork', base), /forked by u/);
	assert.match(formatGithubEvent('issues', { ...base, action: 'opened', issue: { number: 4, title: 'x' } }), /#4 x/);
	assert.equal(formatGithubEvent('issues', { ...base, action: 'closed', issue: {} }), null);
	assert.equal(formatGithubEvent('push', base), null);
	assert.equal(formatGithubEvent('ping', base), null);
	assert.equal(formatGithubEvent('star', {}), null);
});

test('Signatur: richtig ok, falsch/fehlend abgelehnt', () => {
	const body = Buffer.from('{"a":1}');
	const sig = `sha256=${crypto.createHmac('sha256', 's3cret').update(body).digest('hex')}`;
	assert.equal(validSignature('s3cret', body, sig), true);
	assert.equal(validSignature('other', body, sig), false);
	assert.equal(validSignature('s3cret', body, 'sha256=00'), false);
	assert.equal(validSignature('s3cret', body, undefined), false);
	assert.equal(validSignature('', body, sig), false);
});

test('Doppelte Zustellung (gleiche Delivery-ID) wird erkannt', () => {
	assert.equal(isDuplicate('d1'), false);
	assert.equal(isDuplicate('d1'), true);
	assert.equal(isDuplicate(undefined), false);
});
