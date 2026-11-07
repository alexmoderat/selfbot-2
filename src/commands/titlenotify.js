const { listOrLink } = require('../misc/list-reply.js');
const { escape, resolveStreamer, watchTitle } = require('../services/notifications.js');

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
	usage: 'titlenotify <streamer> | remove <streamer> | list | optout | optin',
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
			const list = await core.Query.getRecordset((rs) =>
				rs // TODO(port)
					.select('Streamer_Login')
					.from('selfbot_data', 'Title_Notify')
					.where('Channel = %n', channel.id)
					.where('User_Alias = %n', user.id)
					.flat('Streamer_Login'),
			);
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

			const id = escape(user.twitchId);
			if (first === 'optout') {
				await core.Query.raw(`INSERT IGNORE INTO selfbot_data.Title_Notify_Optout (Streamer_ID) VALUES (${id})`); // TODO(port)
				const removed = await core.Query.raw(`DELETE FROM selfbot_data.Title_Notify WHERE Streamer_ID = ${id}`); // TODO(port)
				return {
					text:
						`@${display}, you're opted out — nobody can subscribe to your title changes anymore` +
						`${removed.affectedRows ? `, ${removed.affectedRows} existing alert(s) removed` : ''}. Undo with "${msg.invocation} optin".`,
				};
			}

			const result = await core.Query.raw(`DELETE FROM selfbot_data.Title_Notify_Optout WHERE Streamer_ID = ${id}`); // TODO(port)
			return {
				text:
					result.affectedRows > 0
						? `@${display}, you're opted back in — others can subscribe to your title changes again.`
						: `@${display}, you weren't opted out.`,
			};
		}

		if (first === 'remove' || first === 'del' || first === 'stop') {
			const streamer = clean(args[1]);
			if (!streamer) {
				return { text: `@${display}, Usage: ${msg.invocation} remove <streamer>` };
			}

			const result = await core.Query.raw(
				`DELETE FROM selfbot_data.Title_Notify WHERE Channel = ${channel.id} AND User_Alias = ${user.id} AND Streamer_Login = ${escape(streamer)}`,
			); // TODO(port)
			return {
				text: result.affectedRows > 0 ? `@${display}, title alert for ${streamer} removed.` : `@${display}, you had no alert for ${streamer}.`,
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

		const optedOut = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Streamer_ID')
				.from('selfbot_data', 'Title_Notify_Optout')
				.where('Streamer_ID = %s', streamer.id)
				.single()
				.flat('Streamer_ID'),
		);
		if (optedOut) {
			return { text: `@${display}, ${first} opted out of title alerts.` };
		}

		watchTitle(streamer.id);
		await core.Query.raw(` // TODO(port)
			INSERT IGNORE INTO selfbot_data.Title_Notify (Channel, Streamer_ID, Streamer_Login, User_Alias)
			VALUES (${channel.id}, ${escape(streamer.id)}, ${escape(streamer.login)}, ${user.id})
		`);
		console.log(`[titlenotify] ${user.name} -> ${streamer.login} in #${channel.name}`);
		return { text: `@${display}, ✅ Title alert for ${first} set. You'll be pinged when they change their title — usually shortly before going live.` };
	},
};
