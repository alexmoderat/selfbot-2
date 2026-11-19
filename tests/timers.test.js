const test = require('node:test');
const assert = require('node:assert/strict');
const { isTimerDue, parseTimerInterval, timerMode } = require('../src/misc/timers.js');

const base = { Enabled: true, Online_Only: false, Offline_Only: false, Interval_Seconds: 3610, Last_Sent: null };
const now = Date.parse('2026-11-19T20:00:00Z');

test('Timer: 1h10s als Intervall (automatisches +ed, 19.11.2026)', () => {
	assert.equal(parseTimerInterval('1h10s'), 3_610_000);
	assert.equal(parseTimerInterval('71m'), 4_260_000);
});

test('Timer: nur offline sendet nur bei sicher offline', () => {
	const timer = { ...base, Offline_Only: true };
	assert.equal(isTimerDue(timer, false, now), true);
	assert.equal(isTimerDue(timer, true, now), false);
	assert.equal(isTimerDue(timer, null, now), false); // Status unbekannt: lieber nicht
	assert.equal(isTimerDue({ ...timer, Last_Sent: now - 3_600_000 }, false, now), false); // 1 h < 1 h 10 s
	assert.equal(isTimerDue({ ...timer, Last_Sent: now - 3_610_000 }, false, now), true);
});

test('Timer: live only und immer unveraendert', () => {
	assert.equal(isTimerDue({ ...base, Online_Only: true }, true, now), true);
	assert.equal(isTimerDue({ ...base, Online_Only: true }, false, now), false);
	assert.equal(isTimerDue(base, null, now), true);
	assert.equal(isTimerDue({ ...base, Enabled: false }, false, now), false);
});

test('Timer: Anzeige der Bedingung', () => {
	assert.equal(timerMode({ Online_Only: true }), 'live only');
	assert.equal(timerMode({ Online_Only: false }), 'always');
	assert.equal(timerMode({ Online_Only: false, Offline_Only: true }), 'offline only');
});

test('Timer: whenlive - nur wenn der andere Channel sicher live ist', () => {
	const timer = { ...base, Offline_Only: true, Live_Channel: 70 };
	assert.equal(isTimerDue(timer, false, now, true), true); // hier offline, ninou2 live
	assert.equal(isTimerDue(timer, false, now, false), false); // ninou2 offline
	assert.equal(isTimerDue(timer, false, now, null), false); // unbekannt
	assert.equal(isTimerDue(timer, true, now, true), false); // hier selbst live
	assert.equal(isTimerDue({ ...base, Offline_Only: true }, false, now), true); // ohne whenlive wie bisher
});
