const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGqlBadges } = require('../src/selfbot/token/twitch-badges-gql.js');

test('parseGqlBadges: Schluessel set_id:version, Channel-Badges ausgelassen', () => {
	const list = parseGqlBadges({
		data: {
			badges: [
				{ setID: 'jordan-x-space-jam', version: '1', title: 'Jordan x Space Jam', description: 'd', user: null },
				{ setID: 'x', version: '2', title: 'Chan', description: '', user: { id: '5' } },
			],
		},
	});
	assert.deepEqual(
		list.map((i) => i.key),
		['jordan-x-space-jam:1'],
	);
	assert.equal(list[0].title, 'Jordan x Space Jam');
});

test('parseGqlBadges: fehlende Liste wirft', () => {
	assert.throws(() => parseGqlBadges({ data: {} }));
});
