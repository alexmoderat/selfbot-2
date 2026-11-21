const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const got = require('got');
const { isRequestError } = require('../src/selfbot/util/crash-guard.js');

describe('crash-guard', () => {
	it('erkennt got-Fehler (Host existiert nicht) als Request-Fehler', async () => {
		const error = await got('https://dieser-host-gibt-es-nicht.invalid/', { retry: 0 }).catch((e) => e);
		assert.equal(isRequestError(error), true);
	});
	it('andere Fehler nicht', () => {
		assert.equal(isRequestError(new TypeError('x')), false);
		assert.equal(isRequestError(null), false);
	});
});
