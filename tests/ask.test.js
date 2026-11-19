const test = require('node:test');
const assert = require('node:assert/strict');

// got() faken, damit kein echter Gemini-Aufruf passiert
const gotPath = require.resolve('../src/token/got.js');
let nextResponse = null;
let lastRequest = null;
require.cache[gotPath] = {
	id: gotPath,
	filename: gotPath,
	loaded: true,
	exports: {
		got: () => async (options) => {
			lastRequest = options;
			return nextResponse;
		},
	},
};
const ask = require('../src/commands/ask.js');

const msg = (text) => ({ displayName: 'ninou2', invocation: 'ask', args: text ? text.split(' ') : [] });

test('ask: Antwort einzeilig ohne Markdown, hart gekuerzt', () => {
	assert.equal(ask.cleanAnswer('**No.** Berlin\nhas `cold` winters.'), 'No. Berlin has cold winters.');
	const long = ask.cleanAnswer('a'.repeat(5000));
	assert.equal(long.length, 1320);
	assert.ok(long.endsWith('…'));
});

test('ask: lange Antwort an Wortgrenzen auf Nachrichten verteilt', () => {
	assert.deepEqual(ask.splitAnswer('short answer.'), ['short answer.']);
	const words = Array.from({ length: 200 }, (_, i) => `zzq${i}`).join(' ');
	const parts = ask.splitAnswer(words);
	assert.ok(parts.length > 1);
	assert.ok(parts.every((p) => p.length <= 440));
	assert.equal(parts.join(' '), words);
});

test('ask: Text aus Gemini-Antwort, Gedanken-Teile ignoriert, leer/gesperrt = null', () => {
	assert.equal(ask.extractAnswer({ candidates: [{ content: { parts: [{ text: 'x', thought: true }, { text: 'Yes.' }] } }] }), 'Yes.');
	assert.equal(ask.extractAnswer({ promptFeedback: { blockReason: 'SAFETY' } }), null);
	assert.equal(ask.extractAnswer({ candidates: [{ finishReason: 'SAFETY' }] }), null);
});

test('ask: ohne Frage Usage, ohne Schluessel Hinweis', async () => {
	assert.equal((await ask.execute(null, msg(''))).text, '@ninou2, Usage: ask <question>');
	const saved = process.env.GEMINI_API_KEY;
	delete process.env.GEMINI_API_KEY;
	assert.equal((await ask.execute(null, msg('zzq'))).text, "@ninou2, the AI isn't set up yet.");
	if (saved !== undefined) {
		process.env.GEMINI_API_KEY = saved;
	}
});

test('ask: Antwort, Kontingent aufgebraucht (429), Fehlerstatus', async () => {
	const saved = process.env.GEMINI_API_KEY;
	process.env.GEMINI_API_KEY = 'zzq-test';
	try {
		nextResponse = { statusCode: 200, body: { candidates: [{ content: { parts: [{ text: 'No. Berlin rarely gets heavy snow.' }] } }] } };
		assert.equal((await ask.execute(null, msg('does it snow a lot in berlin'))).text, '@ninou2, No. Berlin rarely gets heavy snow.');
		assert.equal(lastRequest.method, 'POST');
		assert.equal(lastRequest.headers['x-goog-api-key'], 'zzq-test');
		assert.equal(lastRequest.json.contents[0].parts[0].text, 'does it snow a lot in berlin');

		const long = Array.from({ length: 150 }, (_, i) => `zzq${i}`).join(' ');
		nextResponse = { statusCode: 200, body: { candidates: [{ content: { parts: [{ text: long }] } }] } };
		const result = await ask.execute(null, msg('zzq'));
		assert.ok(result.text.startsWith('@ninou2, zzq0 '));
		assert.ok(result.followUps.length >= 1);
		assert.equal([result.text.slice('@ninou2, '.length), ...result.followUps].join(' '), long);

		nextResponse = { statusCode: 429, body: {} };
		assert.match((await ask.execute(null, msg('zzq'))).text, /limit is used up/);

		nextResponse = { statusCode: 500, body: {} };
		assert.match((await ask.execute(null, msg('zzq'))).text, /status 500/);
	} finally {
		if (saved === undefined) {
			delete process.env.GEMINI_API_KEY;
		} else {
			process.env.GEMINI_API_KEY = saved;
		}
	}
});
