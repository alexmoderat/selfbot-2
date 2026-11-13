const { defineCron } = require('../clients/modules/timers.js');
const { fetchTweets, parseGlobalTweet, eventStatus } = require('../misc/streamdatabase.js');
const { wasAnnounced, markAnnounced, recordRecent } = require('../misc/badge-history.js');
const { enabledChannels } = require('./badge-watch.js');

/**
 * Meldet Tweets von @StreamDatabase ueber neue globale Badges/Emotes (ninou2, 13.11.2026: "thats why i prefer the tweet";
 * alexmoderat: "supinic hat ne api"). Gleicher Schalter und Zusatztext wie badge-watch (Dashboard, standardmaessig aus).
 * Der Tweet kommt meist vor dem Eintrag auf der Seite, deshalb melden "added"-Tweets zuerst und badge-watch bleibt dann still.
 */
const STATE_KEY = 'tweet-watch:seen';
const STATE_TTL = 30 * 864e5;
const KEEP_IDS = 100;
const MAX_AGE_MS = 3 * 3600_000; // aeltere Tweets nach verlorenem Stand nicht noch einmal melden
const MAX_PER_RUN = 5;
const TEXT_LIMIT = 330;

const titleOf = (rest) => rest.split(/\s+(?:Objective|Category|Channel|The event)\b/)[0].trim();

const formatTweet = (tweet, custom = '') => {
	const text = tweet.text.length > TEXT_LIMIT ? `${tweet.text.slice(0, TEXT_LIMIT - 1)}…` : tweet.text;
	const status = eventStatus(tweet.text);
	const base = `${text}${status ? ` ${status}` : ''} (https://x.com/StreamDatabase/status/${tweet.id})`;
	return custom ? `${base} ${custom}` : base;
};

const runTweetWatch = async () => {
	const tweets = await fetchTweets();
	const stored = await bot.Redis.getJSON(STATE_KEY).catch(() => null);
	const seen = Array.isArray(stored) ? new Set(stored) : null;
	await bot.Redis.setJSON(STATE_KEY, tweets.map((i) => i.id).slice(0, KEEP_IDS), STATE_TTL);
	if (!seen) {
		console.log(`[tweet-watch] Erstlauf, ${tweets.length} Tweets gemerkt`);
		return 0;
	}

	const fresh = tweets
		.filter((i) => !seen.has(i.id) && Date.now() - Date.parse(i.createdAt) < MAX_AGE_MS)
		.map((tweet) => ({ tweet, info: parseGlobalTweet(tweet.text) }))
		.filter((i) => i.info && i.info.what !== 'removed')
		.reverse() // aelteste zuerst
		.slice(0, MAX_PER_RUN);
	if (fresh.length === 0) {
		return 0;
	}

	// Verfuegbarkeits-Tweets ("now available ...") fuer !bi merken, auch wenn kein Channel den Alert eingeschaltet hat
	await recordRecent(
		'tweet',
		fresh.filter((i) => i.info.what === 'now available').map(({ tweet }) => ({ title: tweet.text, link: `https://x.com/StreamDatabase/status/${tweet.id}` })),
	).catch((e) => console.warn(`[tweet-watch] Verlauf: ${e?.message ?? e}`));

	const targets = await enabledChannels();
	let sent = 0;
	for (const { tweet, info } of fresh) {
		// "added"-Tweets gegen die Seite abgleichen; "now available" (Bedingungen) sind eigene Meldungen
		if (info.what === 'added') {
			const marker = `added:${info.kind}:${titleOf(info.rest).toLowerCase()}`;
			if (await wasAnnounced(marker).catch(() => false)) {
				console.log(`[tweet-watch] ${tweet.id} schon von badge-watch gemeldet: ${info.rest}`);
				continue;
			}
			await markAnnounced(marker).catch(() => {});
		}

		console.log(`[tweet-watch] ${tweet.id}: ${tweet.text.slice(0, 80)} -> ${targets.length} Channel(s)`);
		for (const { channel, message } of targets) {
			await bot.Channels.send(channel, formatTweet(tweet, message)).catch(() => {});
		}
		sent++;
	}

	return sent;
};

module.exports = defineCron({
	name: 'tweet-watch',
	expression: '30 */2 * * * *',
	description: 'Announces @StreamDatabase tweets about new global Twitch badges and emotes in channels that turned the alerts on.',
	code: async function tweetWatch() {
		await runTweetWatch().catch((e) => console.warn(`[tweet-watch] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { formatTweet, titleOf, runTweetWatch });
