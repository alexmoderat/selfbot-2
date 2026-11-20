const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { evaluate, judge } = require('../src/selfbot/clients/modules/crons/command-selftest.js');

const fresh = () => ({ failures: 0, alerting: false, lastAlertAt: 0 });

test('Melden erst nach 2 Fehlschlaegen, dann Entwarnung, kein Dauerfeuer', () => {
	const s = fresh();
	assert.equal(evaluate(s, false, 0), null);
	assert.equal(evaluate(s, false, 1), 'alert');
	assert.equal(evaluate(s, false, 2), null);
	assert.equal(evaluate(s, false, 25 * 3600_000), 'repeat');
	assert.equal(evaluate(s, true, 26 * 3600_000), 'recover');
	assert.equal(evaluate(s, true, 27 * 3600_000), null);
});

test('Ein einzelner Fehlschlag mit Erholung loest nichts aus', () => {
	const s = fresh();
	assert.equal(evaluate(s, false, 0), null);
	assert.equal(evaluate(s, true, 1), null);
});

test('Bewertung: normale Antwort ok, Fehlerantwort/leer kaputt', () => {
	assert.equal(judge({ text: '@x, 12 followers' }, []), '');
	assert.match(judge({ text: 'Failed to fetch VOD.', success: false }, []), /Fehlerantwort/);
	assert.match(judge({ text: 'Something went wrong' }, []), /Fehlerantwort/);
	assert.equal(judge(undefined, []), 'keine Antwort');
	assert.equal(judge(undefined, ['ok reply']), '');
});
