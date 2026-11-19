const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRecordDate, recordHead, ordinal } = require('../src/commands/whoislivebest.js');

test('Rekord-Datum "the 19th november 2026 UTC" (ninou2, 19.11.2026)', () => {
	assert.equal(formatRecordDate('2026-11-19T20:30:00.000Z'), 'the 19th november 2026 UTC');
	assert.equal(formatRecordDate('2026-11-07T23:59:59.000Z'), 'the 7th november 2026 UTC');
	assert.equal(formatRecordDate('2026-01-01T00:00:00.000Z'), 'the 1st january 2026 UTC');
});

test('Ordnungszahl-Endungen inkl. 11th-13th', () => {
	const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinal);
	assert.deepEqual(got, ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th', '31st']);
});

test('Rekord-Satz mit Anzahl', () => {
	assert.equal(
		recordHead({ Value: 13, Achieved: new Date('2026-11-18T16:02:15Z') }),
		'the most number of channels with the bot that were live at one time was recorded on the 18th november 2026 UTC with 13 channels',
	);
	assert.match(recordHead({ Value: 1, Achieved: new Date('2026-11-18T16:02:15Z') }), /with 1 channel$/);
});
