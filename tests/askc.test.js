const test = require('node:test');
const assert = require('node:assert/strict');

const gotPath = require.resolve('../src/selfbot/token/got.js');
let nextText = 'ok';
let lastRequest = null;
require.cache[gotPath] = {
	id: gotPath,
	filename: gotPath,
	loaded: true,
	exports: {
		got: () => async (options) => {
			lastRequest = options;
			return { statusCode: 200, body: { candidates: [{ content: { parts: [{ text: nextText }] } }] } };
		},
	},
};
const ask = require('../src/selfbot/commands/ask.js');
const askc = require('../src/selfbot/commands/askcontinue.js');
const conversations = require('../src/selfbot/util/ask-conversations.js');

const msg = (text, id = '1') => ({ displayName: 'ninou2', invocation: 'askc', args: text.split(' '), sender: { id } });
const contentsTexts = () => lastRequest.json.contents.map((i) => `${i.role}:${i.parts[0].text}`);

test('askc: Alias und eigener Command', () => {
	assert.equal(askc.name, 'askcontinue');
	assert.deepEqual(askc.aliases, ['askc']);
});

test('askc: Verlauf der letzten Frage geht mit, danach wieder angehaengt', async () => {
	process.env.GEMINI_API_KEY = 'zzq-test';
	conversations.clear();
	nextText = 'Paris.';
	await ask.execute(null, msg('capital of france'));
	assert.deepEqual(contentsTexts(), ['user:capital of france']);

	nextText = 'About 2 million.';
	await askc.execute(null, msg('and how many people live there'));
	assert.deepEqual(contentsTexts(), ['user:capital of france', 'model:Paris.', 'user:and how many people live there']);

	await askc.execute(null, msg('and the area'));
	assert.equal(lastRequest.json.contents.length, 5);
});

test('askc: ohne laufendes Gespraech oder von anderem User ist es eine frische Frage', async () => {
	conversations.clear();
	await askc.execute(null, msg('first thing'));
	assert.deepEqual(contentsTexts(), ['user:first thing']);
	await askc.execute(null, msg('other user', '2'));
	assert.deepEqual(contentsTexts(), ['user:other user']);
});

test('ask: eine neue Frage beendet das alte Gespraech', async () => {
	conversations.clear();
	nextText = 'ok';
	await ask.execute(null, msg('one'));
	await ask.execute(null, msg('two'));
	await askc.execute(null, msg('three'));
	assert.deepEqual(contentsTexts(), ['user:two', 'model:ok', 'user:three']);
});

test('Gespraech: nach 5 Minuten vorbei, Verlauf auf 6 Beitraege begrenzt', () => {
	conversations.clear();
	const t0 = 1_000_000;
	conversations.remember('u', 'q1', 'a1', { now: t0 });
	assert.equal(conversations.active('u', t0 + 5 * 60_000).length, 1);
	assert.equal(conversations.active('u', t0 + 5 * 60_000 + 1).length, 0);

	conversations.remember('v', 'q0', 'a0', { now: t0 });
	for (let i = 1; i <= 8; i++) {
		conversations.remember('v', `q${i}`, `a${i}`, { keep: true, now: t0 + i * 1000 });
	}
	const turns = conversations.active('v', t0 + 9000);
	assert.equal(turns.length, 6);
	assert.equal(turns[0].question, 'q3');
});

test('askc: nach 5 Minuten zaehlt die Frage als frisch', async () => {
	conversations.clear();
	const realNow = Date.now;
	let now = 5_000_000;
	Date.now = () => now;
	try {
		await ask.execute(null, msg('old question'));
		now += 5 * 60_000 + 1;
		await askc.execute(null, msg('late follow up'));
		assert.deepEqual(contentsTexts(), ['user:late follow up']);
	} finally {
		Date.now = realNow;
	}
});
