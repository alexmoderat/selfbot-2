const { describe, it, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../src/selfbot/util/catquery-firehose.js');
const { Logger } = require('../src/selfbot/misc/logger.js');

const send = (message) => _test.handleMessage(JSON.stringify(message));
const chat = (text, tags = {}) => ({ id: 'abc', channel: '#somechannel', text, tags: { 'room-id': '1', 'user-id': '2', 'display-name': 'Someone', ...tags } });

describe('catquery-firehose: Erwaehnungen des eigenen Kontos', () => {
	const mentions = () => {
		const log = mock.method(Logger, 'info', () => {});
		return () => log.mock.calls.map((call) => call.arguments[0]).filter((line) => line.startsWith('[catquery] Erwaehnung'));
	};

	afterEach(() => mock.restoreAll());

	it('meldet den Namen mit Channel, Absender und Text', () => {
		const lines = mentions();
		send(chat('#user alexmoderat'));
		assert.equal(lines().length, 1);
		assert.match(lines()[0], /#somechannel Someone: #user alexmoderat$/);
	});

	it('findet auch die User-ID und Gross-/Kleinschreibung', () => {
		const lines = mentions();
		send(chat('#uid 1153381727'));
		send(chat('hi AlexModerat'));
		assert.equal(lines().length, 2);
	});

	it('zaehlt Antworten auf eigene Nachrichten ueber die Reply-Tags', () => {
		const lines = mentions();
		send(chat('#u', { 'reply-parent-display-name': 'alexmoderat' }));
		assert.equal(lines().length, 1);
	});

	it('ignoriert eigene und unbeteiligte Nachrichten', () => {
		const lines = mentions();
		send(chat('alexmoderat hier', { 'user-id': '1153381727' }));
		send(chat('nichts von Belang'));
		assert.equal(lines().length, 0);
	});
});
