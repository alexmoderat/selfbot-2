const { uploadToOwnHaste } = require('../misc/haste.js');
const { escape, resolveStreamer, watchStreamer, watchTitle } = require('../services/notifications.js');

/**
 * Benachrichtigungen einrichten, aus sb-v2:
 *   notify live <streamer> [text]   Ansage, wenn der Streamer live/offline geht
 *   notify ban <user> [text]        Ansage, wenn der Account einen Twitch-Ban bekommt (crons/ban-watch)
 *   unnotify live|ban <name>, notify list / listevents
 */
const EVENTS = new Set(['live', 'ban']);
const cleanLogin = (s) =>
	String(s ?? '')
		.toLowerCase()
		.replace(/^[@#]+/, '');

const listAll = async (channelId, channelName, display) => {
	const live = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Streamer_Login', 'Message')
			.from('selfbot_data', 'Notify_Live')
			.where('Channel = %n', channelId)
			.orderBy('Added ASC'),
	);
	const ban = await core.Query.getRecordset((rs) =>
		rs // TODO(port)
			.select('Login', 'Message')
			.from('selfbot_data', 'Notify_Ban')
			.where('Channel = %n', channelId)
			.orderBy('Added ASC'),
	);

	if (live.length === 0 && ban.length === 0) {
		return { text: `@${display}, no active event notifications in #${channelName}.` };
	}

	// Immer als Link - die Liste im Chat war zu lang (alexmoderat, 24.10.2026: "im chat das ist arsch");
	// sb-v2 wechselte erst ab 450 Zeichen
	const text = [
		`Event notifications for #${channelName}`,
		'='.repeat(40),
		...(live.length > 0 ? ['', `live (${live.length}):`, ...live.map((i) => `  ${i.Streamer_Login}${i.Message ? ` — ${i.Message}` : ''}`)] : []),
		...(ban.length > 0 ? ['', `ban (${ban.length}):`, ...ban.map((i) => `  ${i.Login}${i.Message ? ` — ${i.Message}` : ''}`)] : []),
	].join('\n');

	try {
		const url = await uploadToOwnHaste(text);
		return { text: `@${display}, Events in #${channelName} (${live.length} live, ${ban.length} ban): ${url}` };
	} catch {
		return { text: `@${display}, Events in #${channelName}: ${live.length} live, ${ban.length} ban (upload failed).` };
	}
};

module.exports = {
	name: 'notify',
	aliases: ['unnotify', 'listevents'],
	cooldown: 3000,
	description: 'Set up notifications for stream start and Twitch bans.',
	usage: 'notify live <streamer> [text] | notify ban <user> [text] | unnotify live|ban <name> | listevents',
	flags: ['mod'],
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		const mode = msg.invocation;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		const sub = args[0]?.toLowerCase();
		// "sb notify listevents" (Xyqra, 24.10.2026) wie "sb listevents" / "sb notify list"
		if (mode === 'listevents' || (mode === 'notify' && (sub === 'list' || sub === 'listevents' || sub === 'events'))) {
			return await listAll(channel.id, channel.name, display);
		}

		if (!sub || !EVENTS.has(sub)) {
			return { text: `@${display}, Usage: ${mode} <live|ban> <name>${mode === 'notify' ? ' [text]' : ''}` };
		}

		const target = cleanLogin(args[1]);
		if (!target) {
			return { text: `@${display}, Usage: ${mode} ${sub} <${sub === 'live' ? 'streamer' : 'user'}>${mode === 'notify' ? ' [text]' : ''}` };
		}

		if (mode === 'unnotify') {
			if (sub === 'live') {
				const result = await core.Query.raw(
					`DELETE FROM selfbot_data.Notify_Live WHERE Channel = ${channel.id} AND Streamer_Login = ${escape(target)}`,
				); // TODO(port)
				return {
					text:
						result.affectedRows > 0
							? `@${display}, Live notification for ${target} removed.`
							: `@${display}, ${target} was not on the live notify list.`,
				};
			}

			const result = await core.Query.raw(`DELETE FROM selfbot_data.Notify_Ban WHERE Channel = ${channel.id} AND Login = ${escape(target)}`); // TODO(port)
			return {
				text: result.affectedRows > 0 ? `@${display}, ✅ ${target} removed from ban watch.` : `@${display}, ${target} was not on ban watch.`,
			};
		}

		const customMessage = args.slice(2).join(' ').trim() || null;
		const extra = customMessage ? ` Message: "${customMessage}"` : '';
		const message = customMessage ? escape(customMessage) : 'NULL';

		if (sub === 'live') {
			const streamer = await resolveStreamer(target);
			if (!streamer) {
				// sb-v2 speicherte trotzdem ("notification saved, but ...") - ohne Twitch-ID kann hier nichts abonniert werden
				return { text: `@${display}, ${target} could not be resolved — please check the name.` };
			}

			await core.Query.raw(` // TODO(port)
				INSERT INTO selfbot_data.Notify_Live (Channel, Streamer_ID, Streamer_Login, Message)
				VALUES (${channel.id}, ${escape(streamer.id)}, ${escape(streamer.login)}, ${message})
				ON DUPLICATE KEY UPDATE Streamer_Login = VALUES(Streamer_Login), Message = VALUES(Message)
			`);
			// Sofort abonnieren, sonst greift es erst mit notify-resync
			watchStreamer(streamer.id);
			watchTitle(streamer.id);
			console.log(`[notify] live ${streamer.login} in #${channel.name}`);
			return { text: `@${display}, ✅ Live notification for ${target} added.${extra}` };
		}

		await core.Query.raw(` // TODO(port)
			INSERT INTO selfbot_data.Notify_Ban (Channel, Login, Message) VALUES (${channel.id}, ${escape(target)}, ${message})
			ON DUPLICATE KEY UPDATE Message = VALUES(Message), Notified = NULL
		`);
		console.log(`[notify] ban ${target} in #${channel.name}`);
		return { text: `@${display}, ✅ Watching ${target} for Twitch bans.${extra}` };
	},
};
