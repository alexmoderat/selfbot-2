const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRecordDate, recordHead } = require('../src/commands/whoislivebest.js');

test('Rekord-Datum wie ninou2s Vorlage ("13 november 2025"), UTC', () => {
	assert.equal(formatRecordDate('2026-11-18T16:02:15.000Z'), '18 november 2026');
	assert.equal(formatRecordDate('2026-11-07T23:59:59.000Z'), '7 november 2026');
	assert.equal(formatRecordDate('2026-01-01T00:00:00.000Z'), '1 january 2026');
});

test('Rekord-Satz mit Anzahl', () => {
	assert.equal(
		recordHead({ Value: 13, Achieved: new Date('2026-11-18T16:02:15Z') }),
		'the most number of channels with the bot that were live at one time was recorded on 18 november 2026 with 13 channels',
	);
	assert.match(recordHead({ Value: 1, Achieved: new Date('2026-11-18T16:02:15Z') }), /with 1 channel$/);
});
