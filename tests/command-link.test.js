const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCommandsUrl } = require('../src/misc/command-catalog.js');

test('Werbe-Nachricht: Link zum Use-Tab im Dashboard (ninou2, 20.11.2026)', async () => {
	const saved = process.env.WEB_BASE_URL;
	process.env.WEB_BASE_URL = 'https://auth.alexmoderat.eu/';
	try {
		assert.equal(await buildCommandsUrl(), 'https://auth.alexmoderat.eu/dashboard#use');
	} finally {
		if (saved === undefined) {
			delete process.env.WEB_BASE_URL;
		} else {
			process.env.WEB_BASE_URL = saved;
		}
	}
});
