const { listOrLink } = require('../misc/list-reply.js');
const { HANDLE, cleanHandle, accountExists } = require('../services/tweet-notify.js');

/**
 * Tweet-Alarm: Ping mit Link, sobald ein X/Twitter-Account einen neuen Tweet postet (ninou2, 13.11.2026: "a twitter command,
 * just like the title and live notifications ... for people u choose to track"). Aufbau wie titlenotify.
 */
module.exports = {
	name: 'tweetnotify',
	aliases: ['tn2', 'tweetalert', 'twitternotify'],
	cooldown: 3000,
	description: 'Alerts you with the link when an X/Twitter account posts a new tweet — and pings you.',
	usage: 'tweetnotify <account> | remove <account> | list',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const user = msg.sender;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const first = cleanHandle(args[0]);
		if (first === 'list') {
			const list = (await bot.DB.TweetNotify.find({ channel: channel.id, userAlias: user.id }, { account: 1 }).lean()).map((i) => i.account);
			return {
				text:
					list.length > 0
						? `@${display}, tweet alerts (${list.length}): ${await listOrLink(list, `Tweet alerts of ${user.name}`)}`
						: `@${display}, no tweet alerts set. Use "${msg.invocation} <account>" to add one.`,
			};
		}

		if (first === 'remove' || first === 'del' || first === 'stop') {
			const account = cleanHandle(args[1]);
			if (!account) {
				return { text: `@${display}, Usage: ${msg.invocation} remove <account>` };
			}

			const result = await bot.DB.TweetNotify.deleteMany({ channel: channel.id, userAlias: user.id, account });
			return { text: result.deletedCount > 0 ? `@${display}, tweet alert for ${account} removed.` : `@${display}, you had no tweet alert for ${account}.` };
		}

		if (!first) {
			return { text: `@${display}, Usage: ${msg.invocation} <account> — pings you with the link when they post a new tweet.` };
		} else if (!HANDLE.test(first)) {
			return { text: `@${display}, "${first}" is not a valid X/Twitter handle.` };
		} else if (!(await accountExists(first))) {
			return { text: `@${display}, no tweets found for "${first}" (unknown account or no public tweets).` };
		}

		await bot.DB.TweetNotify.updateOne({ channel: channel.id, account: first, userAlias: user.id }, { $setOnInsert: { added: new Date() } }, { upsert: true });
		console.log(`[tweetnotify] ${user.name} -> ${first} in #${channel.name}`);
		return { text: `@${display}, ✅ Tweet alert for ${first} set. You'll be pinged with the link when they post a new tweet.` };
	},
};
