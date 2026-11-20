const test = require('node:test');
const assert = require('node:assert/strict');
const { daysAgoWithDate, fmtShortDate } = require('../src/selfbot/util/streamer-streak.js');

test('Datum als Tag/Monat/Jahr (ninou2, 12.11.2026)', () => {
	assert.equal(fmtShortDate('2026-11-10'), '10/11/26');
	assert.equal(fmtShortDate('2026-01-05T04:27:00.000Z'), '05/01/26');
});

test('Tagesabstand mit Datum', () => {
	assert.equal(daysAgoWithDate('2026-11-10', '2026-11-12'), '2 days ago 10/11/26');
	assert.equal(daysAgoWithDate('2026-11-11', '2026-11-12'), '1 day ago 11/11/26');
	assert.equal(daysAgoWithDate('2026-11-12', '2026-11-12'), 'today 12/11/26');
});
