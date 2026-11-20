const test = require('node:test');
const assert = require('node:assert/strict');

const { numbered } = require('../src/selfbot/database/utility.js');

test('utility-db: ? wird zu $1, $2, ... (ausser in Zeichenketten)', () => {
	assert.equal(numbered('SELECT 1 FROM t WHERE a = ? AND b = ? LIMIT ?'), 'SELECT 1 FROM t WHERE a = $1 AND b = $2 LIMIT $3');
	assert.equal(numbered("SELECT '?' AS q, x FROM t WHERE y = ?"), "SELECT '?' AS q, x FROM t WHERE y = $1");
	assert.equal(numbered("WHERE s LIKE 'it''s ?' AND z = ?"), "WHERE s LIKE 'it''s ?' AND z = $1");
	assert.equal(numbered('SELECT 1'), 'SELECT 1');
});
