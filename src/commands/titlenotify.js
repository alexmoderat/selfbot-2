const { Logger } = require('../misc/logger.js');
const { listOrLink } = require('../util/list-reply.js');
const { resolveStreamer, watchTitle } = require('../util/notifications.js');
const { MAX_MESSAGE, MAX_TIMES, cleanMessage, cleanTimes, homeChannel } = require('../util/tweet-notify.js');

/**
 * Alarm auf Titelwechsel eines Streamers, aus sb-v2 - Vorwarnung, die meisten setzen den Titel kurz vor dem
 * Live-Gehen. Das Abo gehoert der Person (Ping an die Abonnenten), deshalb fuer alle.
 */
const clean = (s) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/^[@#]+/, '')
		.trim();

module.exports = {
	name: 'titlenotify',
	aliases: ['tc', 'tn', 'titlealarm'],
	cooldown: 3000,
	description: 'Alerts you when a streamer changes their title — and pings you.',
	usage: `titlenotify <streamer> [x1-x${MAX_TIMES}] [message] | remove <streamer> | list | optout | optin`,
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const user = msg.sender;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const first = clean(args[0]);
		if (first === 'list') {
			const list = (await bot.DB.TitleNotify.find({ userAlias: user.id }, { streamerLogin: 1 }).lean()).map((i) => i.streamerLogin);
			return {
				text:
					list.length > 0
						? `@${display}, title alerts (${list.length}): ${await listOrLink(list, `Title alerts of ${user.name}`)}`
						: `@${display}, no title alerts set. Use "${msg.invocation} <streamer>" to add one.`,
			};
		}

		// optout/optin gilt fuer alle Channels - es geht um die Person
		if (first === 'optout' || first === 'optin') {
			if (!user.twitchId) {
				return { text: `@${display}, I don't know your Twitch ID yet.` };
			}

			const id = user.twitchId;
			if (first === 'optout') {
				await bot.DB.TitleNotifyOptout.updateOne({ streamerId: id }, { $setOnInsert: { added: new Date() } }, { upsert: true });
				const removed = { affectedRows: (await bot.DB.TitleNotify.deleteMany({ streamerId: id })).deletedCount };
				return {
					text:
						`@${display}, you're opted out — nobody can subscribe to your title changes anymore` +
						`${removed.affectedRows ? `, ${removed.affectedRows} existing alert(s) removed` : ''}. Undo with "${msg.invocation} optin".`,
				};
			}

			const result = await bot.DB.TitleNotifyOptout.deleteOne({ streamerId: id });
			return {
				text: result.deletedCount > 0 ? `@${display}, you're opted back in — others can subscribe to your title changes again.` : `@${display}, you weren't opted out.`,
			};
		}

		if (first === 'remove' || first === 'del' || first === 'stop') {
			const streamer = clean(args[1]);
			if (!streamer) {
				return { text: `@${display}, Usage: ${msg.invocation} remove <streamer>` };
			}

			const result = await bot.DB.TitleNotify.deleteMany({ userAlias: user.id, streamerLogin: streamer });
			return {
				text: result.deletedCount > 0 ? `@${display}, title alert for ${streamer} removed.` : `@${display}, you had no alert for ${streamer}.`,
			};
		}

		if (!first) {
			return { text: `@${display}, Usage: ${msg.invocation} <streamer> — pings you when they change their stream title.` };
		}
		if (first === user.name) {
			return { text: `@${display}, you'll notice your own title change without help.` };
		}

		const streamer = await resolveStreamer(first);
		if (!streamer) {
			return { text: `@${display}, streamer "${first}" not found.` };
		}

		const optedOut = await bot.DB.TitleNotifyOptout.exists({ streamerId: streamer.id });
		if (optedOut) {
			return { text: `@${display}, ${first} opted out of title alerts.` };
		}

		// Alles nach dem Streamer ist der eigene Zusatztext (ninou2, 13.11.2026), erneutes Eintragen aendert ihn
		const rest = args.slice(1);
		const timesToken = /^x([1-5])$/i.exec(rest[0] ?? '');
		const times = timesToken ? cleanTimes(timesToken[1]) : 1;
		if (timesToken) {
			rest.shift();
		}
		const rawMessage = rest.join(' ').trim();
		if (rawMessage.length > MAX_MESSAGE) {
			return { text: `@${display}, the message is too long (max ${MAX_MESSAGE} characters).` };
		}
		const message = cleanMessage(rawMessage);

		// Gepostet wird im eigenen Channel der Person, nicht im Chat, in dem der Befehl steht (ninou2, 14.11.2026)
		const home = homeChannel(user);
		if (!home) {
			return {
				text: `@${display}, title alerts are posted in your own channel, but I'm not in #${user.name}. Add me at https://auth.alexmoderat.eu/dashboard first.`,
			};
		}

		watchTitle(streamer.id);
		await bot.DB.TitleNotify.updateOne(
			{ channel: home.id, streamerId: streamer.id, userAlias: user.id },
			{ $set: { message, times }, $setOnInsert: { streamerLogin: streamer.login, added: new Date() } },
			{ upsert: true },
		);
		Logger.info(`[titlenotify] ${user.name} -> ${streamer.login} (gepostet in #${home.name}, eingegeben in #${channel.name})`);
		return {
			text: `@${display}, ✅ Title alert for ${first} set${home.id === channel.id ? '' : ` (posted in #${home.name})`}${times > 1 ? ` (posted ${times}x)` : ''}${message ? ` with your message "${message}"` : ''}. You'll be pinged when they change their title — usually shortly before going live.`,
		};
	},
};
