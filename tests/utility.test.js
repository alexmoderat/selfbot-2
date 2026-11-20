const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../src/selfbot/misc/utility.js');
const { toBadgeList, stripReplyMention, trimMessage, ParseUser } = require('../src/selfbot/util/twitch/utils.js');
const { filterByConfig } = require('../src/selfbot/config.js');

describe('timeDelta (gleiche Ausgabe wie supi-core)', () => {
	const now = new Date('2026-11-07T12:00:00.000Z');
	const ago = (ms) => new Date(now.valueOf() - ms);

	it('Millisekunden, Sekunden, Minuten, Stunden, Tage, Jahre', () => {
		assert.equal(utils.timeDelta(ago(500), false, false, now), '500ms ago');
		assert.equal(utils.timeDelta(ago(5_250), false, false, now), '5.25s ago');
		assert.equal(utils.timeDelta(ago(119_999), false, false, now), '2m, 0s ago');
		assert.equal(utils.timeDelta(ago(3 * 3_600_000 + 5 * 60_000), false, false, now), '3h, 5m ago');
		assert.equal(utils.timeDelta(ago(2 * 86_400_000 + 3 * 3_600_000), false, false, now), '2d, 3h ago');
		assert.equal(utils.timeDelta(ago(400 * 86_400_000), false, false, now), '1y, 35d ago');
	});

	it('Zukunft mit "in", ohne Affixe, gleicher Zeitpunkt', () => {
		assert.equal(utils.timeDelta(new Date(now.valueOf() + 90_000), false, false, now), 'in 1m, 30s');
		assert.equal(utils.timeDelta(new Date(now.valueOf() + 90_000), true, false, now), '1m, 30s');
		assert.equal(utils.timeDelta(now, false, false, new Date(now.valueOf())), 'right now!');
	});
});

describe('Text-Helfer', () => {
	it('wrapString kuerzt mit … und vereinheitlicht Leerraum', () => {
		assert.equal(utils.wrapString('abc  def\nghi', 100), 'abc def ghi');
		assert.equal(utils.wrapString('abcdef', 4), 'abc…');
	});

	it('partitionString teilt nach Woertern', () => {
		assert.deepEqual(utils.partitionString('aaa bbb ccc', 9, 1), ['aaa bbb']);
		assert.deepEqual(utils.partitionString('aaa bbb ccc', 9, 2), ['aaa bbb', 'ccc']);
	});

	it('tag.trim, groupDigits, replaceLinks, splitByCondition, round', () => {
		assert.equal(
			utils.tag.trim`
			a
			${1} b
		`,
			'a 1 b',
		);
		assert.equal(utils.groupDigits(1234567), '1 234 567');
		assert.equal(utils.replaceLinks('see https://example.com now'), 'see [LINK] now');
		assert.deepEqual(
			utils.splitByCondition([1, 2, 3, 4], (i) => i % 2 === 0),
			[
				[2, 4],
				[1, 3],
			],
		);
		assert.equal(utils.round(1.2345, 2), 1.23);
		assert.equal(utils.round(119_999, -3), 120_000);
	});

	it('random bleibt in den Grenzen, randArray nimmt ein Element', () => {
		for (let i = 0; i < 50; i++) {
			const value = utils.random(1, 3);
			assert.ok(value >= 1 && value <= 3);
		}
		assert.equal(utils.randArray([]), undefined);
		assert.ok(['a', 'b'].includes(utils.randArray(['a', 'b'])));
	});
});

describe('Twitch-Helfer', () => {
	it('toBadgeList wandelt dank-twitch-irc-Badges in die EventSub-Form', () => {
		const badges = [
			{ name: 'broadcaster', version: '1' },
			{ name: 'subscriber', version: '12' },
		];
		const info = [{ name: 'subscriber', version: '14' }];
		assert.deepEqual(toBadgeList(badges, info), [
			{ set_id: 'broadcaster', id: '1', info: '' },
			{ set_id: 'subscriber', id: '12', info: '14' },
		]);
	});

	it('stripReplyMention nur bei Antworten', () => {
		assert.equal(stripReplyMention('@ninou2 sb ping', true), 'sb ping');
		assert.equal(stripReplyMention('@ninou2 sb ping', false), '@ninou2 sb ping');
	});

	it('trimMessage und ParseUser', () => {
		assert.equal(trimMessage('a\n b', 10), 'a b');
		assert.equal(trimMessage('abcdef', 4), 'abc…');
		assert.equal(ParseUser('@Ninou2,'), 'ninou2');
	});
});

describe('filterByConfig', () => {
	const items = ['a', 'b', 'c'];
	it('disableAll, whitelist, blacklist', () => {
		assert.deepEqual(
			filterByConfig(items, (i) => i, { disableAll: true, blacklist: [], whitelist: [] }),
			[],
		);
		assert.deepEqual(
			filterByConfig(items, (i) => i, { disableAll: false, blacklist: [], whitelist: ['b'] }),
			['b'],
		);
		assert.deepEqual(
			filterByConfig(items, (i) => i, { disableAll: false, blacklist: ['b'], whitelist: [] }),
			['a', 'c'],
		);
	});
});
