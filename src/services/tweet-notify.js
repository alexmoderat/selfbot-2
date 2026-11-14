const { fetchTweetsOf } = require('../misc/streamdatabase.js');
const { fmtLengthShort } = require('../misc/streamer-streak.js');

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
// Alter des Tweets in Klammern (ninou2, 14.11.2026: "it didnt tell that the original tweet time was 11min ago" -> "[11min ago]")
const agoTag = (createdAt, now = Date.now()) => {
	const ms = now - Date.parse(createdAt);
	if (Number.isNaN(ms)) {
		return '';
	}
	return ms < 60_000 ? '[just now]' : `[${fmtLengthShort(ms)} ago]`;
};

const formatTweetAlert = (users, account, tweet, custom = '', now = Date.now()) => {
	const text = tweet.text.length > TEXT_LIMIT ? `${tweet.text.slice(0, TEXT_LIMIT - 1)}…` : tweet.text;
	const age = tweet.createdAt ? agoTag(tweet.createdAt, now) : '';
	const base = `${users.map((i) => `@${i}`).join(' ')} — @${account} tweeted${text ? `: ${text}` : ''}${age ? ` ${age}` : ''} https://x.com/${account}/status/${tweet.id}`;
	return custom ? `${base} ${custom}` : base;
};

const MAX_MESSAGE = 200;
// Wie oft die Meldung gepostet wird, 1-5 (ninou2, 13.11.2026: "add a text called 'number' ... how many times you want the bot to post the message")
const MAX_TIMES = 5;
const cleanTimes = (input) => {
	const n = Number.parseInt(String(input ?? '1'), 10);
	return Number.isNaN(n) ? 1 : Math.min(MAX_TIMES, Math.max(1, n));
};

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

/**
 * Alarme werden immer im EIGENEN Channel der Person gepostet, auch wenn der Befehl in einem fremden Chat eingegeben wurde
 * (ninou2, 14.11.2026: "even if you create a notification in another channel it should only be posted in your own channel ...
 * so bot does not bother channel's owner if they didn't consent to an action by the bot"). Null = Bot nicht im eigenen Channel.
 */
const homeChannel = (user) => {
	const channel = bot.Channels.get(String(user?.name ?? ''));
	return channel && channel.mode !== 'Inactive' ? channel : null;
};

module.exports = { homeChannel, agoTag, HANDLE, MAX_MESSAGE, MAX_TIMES, cleanTimes, cleanMessage, cleanHandle, isStandalone, formatTweetAlert, freshTweets, checkAccount, accountExists };
