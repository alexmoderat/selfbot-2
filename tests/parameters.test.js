const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseParametersFromArguments, parseRegex } = require('../src/clients/modules/parameters.js');

const defs = [
	{ name: 'channel', type: 'string' },
	{ name: 'count', type: 'number' },
	{ name: 'raw', type: 'boolean' },
];

describe('parseParametersFromArguments', () => {
	it('trennt Parameter von normalen Argumenten', () => {
		assert.deepEqual(parseParametersFromArguments(defs, ['hello', 'channel:forsen', 'count:5', 'world']), {
			success: true,
			args: ['hello', 'world'],
			parameters: { channel: 'forsen', count: 5 },
		});
	});

	it('liest Werte in Anfuehrungszeichen ueber mehrere Woerter', () => {
		assert.deepEqual(parseParametersFromArguments(defs, ['channel:"two', 'words"', 'rest']), {
			success: true,
			args: ['rest'],
			parameters: { channel: 'two words' },
		});
		assert.deepEqual(parseParametersFromArguments(defs, ['channel:"one"']), { success: true, args: [], parameters: { channel: 'one' } });
	});

	it('meldet offene Anfuehrungszeichen und falsche Typen', () => {
		assert.equal(parseParametersFromArguments(defs, ['channel:"open', 'end']).success, false);
		assert.equal(parseParametersFromArguments(defs, ['count:abc']).success, false);
		assert.equal(parseParametersFromArguments(defs, ['count:']).success, false);
		assert.equal(parseParametersFromArguments(defs, ['raw:yes']).success, false);
	});

	it('parst Booleans', () => {
		assert.deepEqual(parseParametersFromArguments(defs, ['raw:true']), { success: true, args: [], parameters: { raw: true } });
	});

	it('laesst unbekannte name:wert-Tokens und URLs als Argumente stehen', () => {
		assert.deepEqual(parseParametersFromArguments(defs, ['foo:bar', 'https://example.com']), {
			success: true,
			args: ['foo:bar', 'https://example.com'],
			parameters: {},
		});
	});

	it('liest nach -- keine Parameter mehr', () => {
		assert.deepEqual(parseParametersFromArguments(defs, ['count:1', '--', 'count:2']), { success: true, args: ['count:2'], parameters: { count: 1 } });
	});
});

describe('Parameter-Typ regex', () => {
	it('liest /body/flags und nackten Text wie supi-core', () => {
		assert.equal(String(parseRegex(';', false)), '/;/');
		assert.equal(String(parseRegex('/a|b/i', false)), '/a|b/i');
		assert.equal(parseRegex('(', false), null);
	});

	it('erzwingt mit linearer Engine das l-Flag und ersetzt i durch Zeichengruppen', () => {
		assert.equal(String(parseRegex('/ab/i', true)), '/[aA][bB]/l');
	});

	it('liefert im Parser ein RegExp-Objekt', () => {
		const result = parseParametersFromArguments([{ name: 'delimiter', type: 'regex' }], ['delimiter:;', 'a;b']);
		assert.equal(result.success, true);
		assert.ok(result.parameters.delimiter instanceof RegExp);
		assert.deepEqual(result.args, ['a;b']);
	});
});
