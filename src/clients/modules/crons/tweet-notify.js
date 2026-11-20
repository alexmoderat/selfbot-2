const { defineCron } = require('../timers.js');
const { checkAccount, cleanTimes, formatTweetAlert } = require('../../../util/tweet-notify.js');

/**
 * Prueft die per !tweetnotify / Dashboard eingetragenen X/Twitter-Accounts auf neue Tweets (ninou2, 13.11.2026) und pingt
 * die Abonnenten im jeweiligen Channel mit dem Link. Ein Abruf je Account, nacheinander mit kleiner Pause (supinic.com schonen).
 */
const PAUSE_MS = 1500;

const sendTo = async (channelId, text) => {
	const channel = bot.Channels.get(channelId);
	if (channel && channel.mode !== 'Inactive') {
		await bot.Channels.send(channel, text).catch((e) => console.warn(`[tweet-notify] #${channel.name}`, e));
	}
};

const announce = async (account, tweet) => {
	const rows = await bot.DB.TweetNotify.find({ account }).lean();
	// Je Channel und Zusatztext eine Meldung (Abonnenten mit demselben Text werden zusammen angepingt)
	const groups = new Map();
	for (const row of rows) {
		const user = await bot.Users.get(row.userAlias);
		if (user) {
			const times = cleanTimes(row.times);
			const key = `${row.channel}\u0000${row.message ?? ''}\u0000${times}`;
			const group = groups.get(key) ?? { channel: row.channel, message: row.message ?? '', times, users: [] };
			group.users.push(user.name);
			groups.set(key, group);
		}
	}

	for (const { channel, message, times, users } of groups.values()) {
		for (let i = 0; i < times; i++) {
			await sendTo(channel, formatTweetAlert(users, account, tweet, message));
		}
	}
	console.log(`[tweet-notify] @${account}: ${tweet.id} -> ${groups.size} Meldung(en)`);
};

const runTweetNotify = async () => {
	const accounts = await bot.DB.TweetNotify.distinct('account');
	let sent = 0;
	for (const account of accounts) {
		try {
			const { fresh, firstRun } = await checkAccount(account);
			if (firstRun) {
				console.log(`[tweet-notify] @${account}: Erstlauf, Stand gemerkt`);
			}
			for (const tweet of fresh.slice(-3)) {
				await announce(account, tweet);
				sent++;
			}
		} catch (e) {
			console.warn(`[tweet-notify] @${account}: ${e?.message ?? e}`);
			// Faellt supinics API aus (HTTP 5xx), den Rest dieses Laufs nicht auch noch anfragen
			if (/HTTP 5\d\d/.test(String(e?.message))) {
				console.warn('[tweet-notify] API nicht erreichbar, Rest dieses Laufs uebersprungen');
				break;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
	}

	return sent;
};

module.exports = defineCron({
	name: 'tweet-notify',
	expression: '15 */2 * * * *',
	description: 'Pings subscribers with the link when a tracked X/Twitter account posts a new tweet.',
	code: async function tweetNotify() {
		await runTweetNotify().catch((e) => console.warn(`[tweet-notify] ${e?.message ?? e}`));
	},
});

Object.assign(module.exports, { runTweetNotify });
