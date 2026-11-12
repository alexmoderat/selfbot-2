const test = require('node:test');
const assert = require('node:assert/strict');
global.bot = global.bot ?? {};
const { formatApiEvent, newEvents, latestId } = require('../src/crons/github-watch.js');

const ev = (id, type, payload = {}) => ({ id: String(id), type, repo: { name: 'a/b' }, actor: { login: 'u' }, payload });

test('Events-API: Stern, Fork, Issue; Push und Schliessen bleiben still', () => {
	assert.equal(formatApiEvent(ev(1, 'WatchEvent', { action: 'started' })), "⭐ New star on 'a/b' by u");
	assert.match(formatApiEvent(ev(2, 'ForkEvent')), /forked by u/);
	assert.match(formatApiEvent(ev(3, 'IssuesEvent', { action: 'opened', issue: { number: 4, title: 'x' } })), /#4 x/);
	assert.equal(formatApiEvent(ev(4, 'IssuesEvent', { action: 'closed', issue: {} })), null);
	assert.equal(formatApiEvent(ev(5, 'PushEvent')), null);
});

test('Erstlauf meldet nichts, danach nur Neues, aelteste zuerst', () => {
	const events = [ev(30, 'WatchEvent'), ev(20, 'ForkEvent'), ev(10, 'WatchEvent')];
	assert.deepEqual(newEvents(events, null), []);
	assert.deepEqual(
		newEvents(events, '10').map((e) => e.id),
		['20', '30'],
	);
	assert.deepEqual(newEvents(events, '30'), []);
	assert.equal(latestId(events, '0'), '30');
	assert.equal(latestId([], '5'), '5');
});
