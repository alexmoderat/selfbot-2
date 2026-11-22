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

describe('Reminder-History: Zaehlung pro Zeitraum', () => {
	const { reminderPeriodCounts } = require('../src/api/reminders.js');
	it('trennt all time, Jahr und Monat', () => {
		const dates = ['2025-11-08T10:00:00Z', '2026-10-31T23:59:59Z', '2026-11-01T00:00:00Z', '2026-11-08T10:00:00Z'];
		assert.deepEqual(reminderPeriodCounts(dates, new Date('2026-11-08T18:00:00Z')), {
			all: 4,
			year: 3,
			yearLabel: '2026',
			month: 2,
			monthLabel: 'November 2026',
		});
	});
});
