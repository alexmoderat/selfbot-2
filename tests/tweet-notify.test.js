const test = require('node:test');
const assert = require('node:assert/strict');

global.bot = global.bot ?? {};
const { cleanHandle, cleanMessage, HANDLE, isStandalone, freshTweets, formatTweetAlert } = require('../src/util/tweet-notify.js');

test('cleanHandle: @, URL und Gross-/Kleinschreibung', () => {
	assert.equal(cleanHandle('@XQC'), 'xqc');
	assert.equal(cleanHandle('https://x.com/Asmongold/status/123'), 'asmongold');
	assert.equal(cleanHandle('twitter.com/NASA?lang=en'), 'nasa');
	assert.equal(cleanHandle(undefined), '');
	assert.ok(HANDLE.test('a_b9'));
	assert.ok(!HANDLE.test('zu lang oder mit leer'));
	assert.ok(!HANDLE.test('x'.repeat(16)));
});

test('freshTweets: Erstlauf meldet nichts, danach nur neue eigene Tweets, aelteste zuerst', () => {
	const now = Date.parse('2026-11-13T22:00:00Z');
	const t = (id, text, min) => ({ id, text, createdAt: new Date(now - min * 60_000).toISOString() });
	const tweets = [t('4', 'neu b', 1), t('3', 'RT @x: weitergeleitet', 2), t('2', '@wer antwort', 3), t('1', 'alt', 5)];
	assert.deepEqual(freshTweets(tweets, null, now), []);
	assert.deepEqual(freshTweets(tweets, new Set(['1']), now).map((i) => i.id), ['4']);
	const old = [t('9', 'sehr alt', 600)];
	assert.deepEqual(freshTweets(old, new Set(), now), []);
	assert.ok(isStandalone(t('5', 'hallo', 1)));
});

test('formatTweetAlert: Ping, Text gekuerzt, Link', () => {
	const text = formatTweetAlert(['ninou2', 'alex'], 'xqc', { id: '77', text: 'hi' });
	assert.equal(text, '@ninou2 @alex — @xqc tweeted: hi https://x.com/xqc/status/77');
	const long = formatTweetAlert(['a'], 'x', { id: '1', text: 'y'.repeat(300) });
	assert.ok(long.includes('…') && long.endsWith('https://x.com/x/status/1'));
});

test('Zusatztext: wird bereinigt, gekuerzt und an die Meldung gehaengt', () => {
	assert.equal(cleanMessage('  hi \n  there  '), 'hi there');
	assert.equal(cleanMessage(undefined), '');
	assert.equal(cleanMessage('x'.repeat(500)).length, 200);
	assert.equal(formatTweetAlert(['a'], 'xqc', { id: '1', text: 'hi' }, 'LETSGO'), '@a — @xqc tweeted: hi https://x.com/xqc/status/1 LETSGO');
});

test('Title Notify: Zusatztext steht hinter der Meldung', () => {
	global.bot = global.bot ?? {};
	const { formatTitleChange } = require('../src/util/notifications.js');
	assert.equal(formatTitleChange(['a'], 'xqc', ' Neu ', 'Just Chatting', null, 'LETSGO'), '@a — @xqc changed their title: " Neu " (Category: Just Chatting) LETSGO');
	assert.equal(formatTitleChange(['a'], 'xqc', 'Neu', null), '@a — @xqc changed their title: " Neu "');
});

test('Anzahl der Meldungen: 1-5, ungueltig = 1', () => {
	const { cleanTimes, MAX_TIMES } = require('../src/util/tweet-notify.js');
	assert.equal(MAX_TIMES, 5);
	assert.equal(cleanTimes(undefined), 1);
	assert.equal(cleanTimes('3'), 3);
	assert.equal(cleanTimes('9'), 5);
	assert.equal(cleanTimes('0'), 1);
	assert.equal(cleanTimes('abc'), 1);
});

test('Alter des Tweets in Klammern', () => {
	const { agoTag, formatTweetAlert } = require('../src/util/tweet-notify.js');
	const now = Date.parse('2026-11-14T00:30:00Z');
	assert.equal(agoTag('2026-11-14T00:19:00Z', now), '[11min ago]');
	assert.equal(agoTag('2026-11-14T00:29:40Z', now), '[just now]');
	assert.equal(agoTag('2026-11-13T22:00:00Z', now), '[2h 30min ago]');
	assert.equal(
		formatTweetAlert(['a'], 'twitch', { id: '1', text: 'hi', createdAt: '2026-11-14T00:19:00Z' }, '', now),
		'@a — @twitch tweeted: hi [11min ago] https://x.com/twitch/status/1',
	);
});
