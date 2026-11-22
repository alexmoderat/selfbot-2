const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkConfirmation, isAltPrefixOwnedElsewhere, isAltPrefixFullCommand, isMissingRequiredArgument, parseInvocation, prefixProblem } = require('../src/clients/modules/invocation.js');
const { formatParams } = require('../src/clients/modules/parameters.js');

const noPrefix = new Set(['8ball', 'vod']);
const isNoPrefix = (name) => noPrefix.has(name);

describe('parseInvocation', () => {
	it('erkennt Prefix mit und ohne Leerzeichen, unabhaengig von Gross-/Kleinschreibung', () => {
		assert.deepEqual(parseInvocation('sb ping a b', 'sb', isNoPrefix), { invocation: 'ping', args: ['a', 'b'], altOnly: false, usedPrefix: 'sb ' });
		assert.equal(parseInvocation('SB Ping', 'sb', isNoPrefix)?.invocation, 'ping');
		assert.deepEqual(parseInvocation('?ping x', '?', isNoPrefix), { invocation: 'ping', args: ['x'], altOnly: false, usedPrefix: '?' });
		assert.equal(parseInvocation('? ping', '?', isNoPrefix)?.invocation, 'ping');
	});

	it('loest ohne Prefix oder bei leerem Rest nichts aus', () => {
		assert.equal(parseInvocation('ping', 'sb', isNoPrefix), null);
		assert.equal(parseInvocation('hello vanish world', 'sb', isNoPrefix), null);
		assert.equal(parseInvocation('sb', 'sb', isNoPrefix), null);
		assert.equal(parseInvocation('sb   ', 'sb', isNoPrefix), null);
		assert.equal(parseInvocation('?', '?', isNoPrefix), null);
	});

	it('Zweit-Prefix ! nur fuer no-prefix-Commands, sonst altOnly', () => {
		assert.deepEqual(parseInvocation('!8ball will it work', 'sb', isNoPrefix), {
			invocation: '8ball',
			args: ['will', 'it', 'work'],
			altOnly: false,
			usedPrefix: '!',
		});
		assert.equal(parseInvocation('!ping', 'sb', isNoPrefix)?.altOnly, true);
		assert.equal(parseInvocation('!', 'sb', isNoPrefix), null);
	});

	it('Prefix ! selbst wird nicht als Zweit-Prefix behandelt', () => {
		assert.deepEqual(parseInvocation('!ping', '!', isNoPrefix), { invocation: 'ping', args: [], altOnly: false, usedPrefix: '!' });
	});

	it('Zweit-Prefix abschaltbar (Parallelbetrieb mit dem alten selfbot)', () => {
		assert.equal(parseInvocation('!8ball x', 'sbn', isNoPrefix, null), null);
		assert.equal(parseInvocation('sbn ping', 'sbn', isNoPrefix, null)?.invocation, 'ping');
	});

	it('"sbn ping" ist fuer Prefix "sb" kein ping (alter und neuer Bot kommen sich nicht in die Quere)', () => {
		assert.equal(parseInvocation('sbn ping', 'sb', isNoPrefix)?.invocation, 'n');
	});
});

describe('checkConfirmation', () => {
	it('verlangt yes am Ende und entfernt es', () => {
		assert.deepEqual(checkConfirmation(['reset']), { destructive: true, confirmed: false, args: ['reset'] });
		assert.deepEqual(checkConfirmation(['reset', 'YES']), { destructive: true, confirmed: true, args: ['reset'] });
		assert.deepEqual(checkConfirmation(['show', 'yes']), { destructive: false, confirmed: false, args: ['show', 'yes'] });
	});
});

describe('isMissingRequiredArgument', () => {
	it('nur bei <Pflicht> ohne | und ohne Argumente', () => {
		assert.equal(isMissingRequiredArgument('8ball <question>', []), true);
		assert.equal(isMissingRequiredArgument('8ball <question>', ['x']), false);
		assert.equal(isMissingRequiredArgument('roll [min max | NdM]', []), false);
		assert.equal(isMissingRequiredArgument('x <a> | <b>', []), false);
		assert.equal(isMissingRequiredArgument(null, []), false);
	});
});

describe('utility-Channels', () => {
	const utility = ['ninou2', 'testaccountalexmoderat', 'im_row1'];
	it('"!" gehoert dort dem utility-bot, "sb" bleibt beim Bot (alexmoderat, 24.10.2026)', () => {
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('!remind me in 5m zzq', 'sb', () => true),
				'ninou2',
				utility,
			),
			true,
		);
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('sb remind me in 5m zzq', 'sb', () => true),
				'ninou2',
				utility,
			),
			false,
		);
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('!remind me in 5m zzq', 'sb', () => true),
				'alexmoderat',
				utility,
			),
			false,
		);
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('!remind x', 'sb', () => true),
				null,
				utility,
			),
			false,
		);
	});

	it('kennt der utility-bot den Command nicht (ninou2: "!title"), antwortet der Bot', () => {
		const knows = (invocation) => invocation === 'remind';
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('!title xqc', '!', () => true),
				'ninou2',
				utility,
				knows,
			),
			false,
		);
		assert.equal(
			isAltPrefixOwnedElsewhere(
				parseInvocation('!remind me in 5m x', '!', () => true),
				'ninou2',
				utility,
				knows,
			),
			true,
		);
	});
});

describe('prefixProblem', () => {
	it('hoechstens 3 Zeichen, keine Leerzeichen, nicht / oder .', () => {
		assert.equal(prefixProblem('!'), null);
		assert.equal(prefixProblem('abc'), null);
		assert.match(prefixProblem('abcd'), /3 characters/);
		assert.match(prefixProblem('a b'), /spaces/);
		assert.match(prefixProblem('/x'), /Twitch/);
	});
});

describe('Bestaetigungshinweis', () => {
	it('behaelt Parameter wie channel:', () => {
		assert.deepEqual(formatParams({ channel: 'ninou2', reason: 'two words', empty: undefined }), ['channel:ninou2', 'reason:"two words"']);
	});
});

describe('"!" als vollwertiger Prefix in utility-Channels', () => {
	const utility = ['ninou2', 'im_row1'];
	const parse = (text) => parseInvocation(text, 'sb', () => false);

	it('"!ll" in ninou2 laeuft wie "sb ll", anderswo bleibt "!" auf no-prefix-Commands beschraenkt', () => {
		assert.equal(isAltPrefixFullCommand(parse('!ll'), 'ninou2', utility), true);
		assert.equal(isAltPrefixFullCommand(parse('!LL xqc'), 'Im_Row1', utility), true);
		assert.equal(isAltPrefixFullCommand(parse('!ll'), 'alexmoderat', utility), false);
		assert.equal(isAltPrefixFullCommand(parse('!ll'), null, utility), false);
	});

	it('"sb ll" und no-prefix-Commands sind nicht betroffen', () => {
		assert.equal(isAltPrefixFullCommand(parse('sb ll'), 'ninou2', utility), false);
		assert.equal(
			isAltPrefixFullCommand(
				parseInvocation('!title xqc', 'sb', () => true),
				'ninou2',
				utility,
			),
			false,
		);
	});
});
