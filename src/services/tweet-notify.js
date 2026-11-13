const { fetchTweetsOf } = require('../misc/streamdatabase.js');

/**
 * Tweet-Alarme (ninou2, 13.11.2026: "a twitter command, just like the title and live notifications ... track tweets by
 * people ... post the link of the tweet"). Daten ueber supinics Syndication-API, siehe misc/streamdatabase.js.
 */
const HANDLE = /^[a-z0-9_]{1,15}$/i;
const MAX_AGE_MS = 3 * 3600_000; // aeltere Tweets nach verlorenem Stand nicht noch einmal melden
const TEXT_LIMIT = 160;

const cleanHandle = (input) =>
	String(input ?? '')
		.toLowerCase()
		.replace(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//, '')
		.replace(/[/?].*$/, '')
		.replace(/^[@#]+/, '')
		.trim();

/** Retweets ("RT @...") und Antworten ("@...") sind keine eigenen Tweets */
const isStandalone = (tweet) => !/^RT @/.test(tweet.text) && !tweet.text.startsWith('@');

// custom: eigener Zusatztext der Abonnenten (ninou2, 13.11.2026: "add the option to add a custom message with it")
const formatTweetAlert = (users, account, tweet, custom = '') => {
	const text = tweet.text.length > TEXT_LIMIT ? `${tweet.text.slice(0, TEXT_LIMIT - 1)}…` : tweet.text;
	const base = `${users.map((i) => `@${i}`).join(' ')} — @${account} tweeted${text ? `: ${text}` : ''} https://x.com/${account}/status/${tweet.id}`;
	return custom ? `${base} ${custom}` : base;
};

const MAX_MESSAGE = 200;
const cleanMessage = (input) => String(input ?? '').replaceAll(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);

/** Neue Tweets gegenueber dem gemerkten Stand (null = Erstlauf, nichts melden), aelteste zuerst */
const freshTweets = (tweets, seen, now = Date.now()) =>
	seen
		? tweets
				.filter((i) => !seen.has(i.id) && isStandalone(i) && now - Date.parse(i.createdAt) < MAX_AGE_MS)
				.reverse()
		: [];

const checkAccount = async (account) => {
	const tweets = await fetchTweetsOf(account);
	const key = `tweet-notify:seen:${account}`;
	const stored = await bot.Redis.getJSON(key).catch(() => null);
	const seen = Array.isArray(stored) ? new Set(stored) : null;
	await bot.Redis.setJSON(key, tweets.map((i) => i.id).slice(0, 60), 60 * 864e5);
	return { tweets, fresh: freshTweets(tweets, seen), firstRun: !seen };
};

const accountExists = async (account) => {
	if (!HANDLE.test(account)) {
		return false;
	}

	// Unbekannte Accounts liefern 200 mit leerer Liste, ein Konto ohne oeffentliche Tweets ist damit nicht abonnierbar
	const tweets = await fetchTweetsOf(account).catch(() => null);
	return Array.isArray(tweets) && tweets.length > 0;
};

module.exports = { HANDLE, MAX_MESSAGE, cleanMessage, cleanHandle, isStandalone, formatTweetAlert, freshTweets, checkAccount, accountExists };
