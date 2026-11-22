const { Logger } = require('../misc/logger.js');
const { listOrLink } = require('../util/list-reply.js');
const { HANDLE, MAX_MESSAGE, MAX_TIMES, cleanHandle, cleanMessage, cleanTimes, accountExists, homeChannel } = require('../util/tweet-notify.js');

/**
 * Tweet-Alarm: Ping mit Link, sobald ein X/Twitter-Account einen neuen Tweet postet (ninou2, 13.11.2026: "a twitter command,
 * just like the title and live notifications ... for people u choose to track"). Aufbau wie titlenotify.
 */
const command = {
	name: 'tweetnotify',
	aliases: ['twn', 'tn2', 'tweetalert', 'twitternotify'],
	cooldown: { user: 3 },
	access: { channel: 0 },
	description: 'Alerts you with the link when an X/Twitter account posts a new tweet — and pings you.',
	usage: `tweetnotify <account> [x1-x${MAX_TIMES}] [message] | remove <account> | list`,
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const user = msg.sender;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		const first = cleanHandle(args[0]);
		if (first === 'list') {
			const list = (await bot.DB.TweetNotify.find({ userAlias: user.id }, { account: 1 }).lean()).map((i) => i.account);
			return list.length > 0
						? `@${display}, tweet alerts (${list.length}): ${await listOrLink(list, `Tweet alerts of ${user.name}`)}`
						: `@${display}, no tweet alerts set. Use "${msg.invocation} <account>" to add one.`;
		}

		if (first === 'remove' || first === 'del' || first === 'stop') {
			const account = cleanHandle(args[1]);
			if (!account) {
				return `@${display}, Usage: ${msg.invocation} remove <account>`;
			}

			const result = await bot.DB.TweetNotify.deleteMany({ userAlias: user.id, account });
			return result.deletedCount > 0 ? `@${display}, tweet alert for ${account} removed.` : `@${display}, you had no tweet alert for ${account}.`;
		}

		if (!first) {
			return `@${display}, Usage: ${msg.invocation} <account> — pings you with the link when they post a new tweet.`;
		} else if (!HANDLE.test(first)) {
			return `@${display}, "${first}" is not a valid X/Twitter handle.`;
		} else if (!(await accountExists(first))) {
			return `@${display}, no tweets found for "${first}" (unknown account or no public tweets).`;
		}

		// Alles nach dem Account ist der eigene Zusatztext (ninou2, 13.11.2026), erneutes Eintragen aendert ihn
		// Optional "x3" direkt hinter dem Account: so oft wird die Meldung gepostet (1-5), Standard 1
		const rest = args.slice(1);
		const timesToken = /^x([1-5])$/i.exec(rest[0] ?? '');
		const times = timesToken ? cleanTimes(timesToken[1]) : 1;
		if (timesToken) {
			rest.shift();
		}
		const message = cleanMessage(rest.join(' '));
		if (rest.join(' ').trim().length > MAX_MESSAGE) {
			return `@${display}, the message is too long (max ${MAX_MESSAGE} characters).`;
		}

		// Gepostet wird im eigenen Channel der Person, nicht im Chat, in dem der Befehl steht
		const home = homeChannel(user);
		if (!home) {
			return `@${display}, tweet alerts are posted in your own channel, but I'm not in #${user.name}. Add me at https://auth.alexmoderat.eu/dashboard first.`;
		}

		await bot.DB.TweetNotify.updateOne({ channel: home.id, account: first, userAlias: user.id }, { $set: { message, times }, $setOnInsert: { added: new Date() } }, { upsert: true });
		Logger.info(`[tweetnotify] ${user.name} -> ${first} (gepostet in #${home.name}, eingegeben in #${channel.name})`);
		return `@${display}, ✅ Tweet alert for ${first} set${home.id === channel.id ? '' : ` (posted in #${home.name})`}${times > 1 ? ` (posted ${times}x)` : ''}${message ? ` with your message "${message}"` : ''}. You'll be pinged with the link when they post a new tweet.`;
	},
};

module.exports = { command };
