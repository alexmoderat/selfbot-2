const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { historyWhere } = require('../src/api/reminders.js');

describe('Reminder-History: Spalte Where', () => {
	it('eigener Reminder nennt nur den Ort', () => {
		assert.equal(historyWhere('ZzqUser', 'zzquser', 'zzquser', '#zzq'), '#zzq');
	});
	it('von jemand anderem bekommen', () => {
		assert.equal(historyWhere('zzquser', 'zzquser', 'zzqother', '#zzq'), 'from @zzqother, #zzq');
	});
	it('fuer jemand anderen gesetzt', () => {
		assert.equal(historyWhere('zzquser', 'zzqother', 'zzquser', 'private'), 'for @zzqother, private');
	});
	it('Systemreminder ohne Absender', () => {
		assert.equal(historyWhere('zzquser', 'zzquser', null, '#zzq'), '#zzq');
	});
});
