const { uploadToOwnHaste } = require('../token/haste.js');
const { resolveStreamer, watchStreamer, watchTitle } = require('../util/notifications.js');
const { cleanTimes } = require('../util/tweet-notify.js');

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
	const live = (await bot.DB.NotifyLive.find({ channel: channelId }).sort({ added: 1 }).lean()).map((i) => ({
		Streamer_Login: i.streamerLogin,
		Message: i.message,
	}));
	const ban = (await bot.DB.NotifyBan.find({ channel: channelId }).sort({ added: 1 }).lean()).map((i) => ({ Login: i.login, Message: i.message }));

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
	usage: 'notify live <streamer> [x1-x5] [text] | notify ban <user> [text] | unnotify live|ban <name> | listevents',
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
				const result = await bot.DB.NotifyLive.deleteMany({ channel: channel.id, streamerLogin: target });
				return {
					text:
						result.deletedCount > 0
							? `@${display}, Live notification for ${target} removed.`
							: `@${display}, ${target} was not on the live notify list.`,
				};
			}

			const result = await bot.DB.NotifyBan.deleteMany({ channel: channel.id, login: target });
			return {
				text: result.deletedCount > 0 ? `@${display}, ✅ ${target} removed from ban watch.` : `@${display}, ${target} was not on ban watch.`,
			};
		}

		// notify live <streamer> [x1-x5] [text]: x3 = die Ansage wird 3x gepostet (ninou2, 13.11.2026)
		const rest = args.slice(2);
		const timesToken = sub === 'live' ? /^x([1-5])$/i.exec(rest[0] ?? '') : null;
		const times = timesToken ? cleanTimes(timesToken[1]) : 1;
		if (timesToken) {
			rest.shift();
		}
		const customMessage = rest.join(' ').trim() || null;
		const extra = `${times > 1 ? ` Posted ${times}x.` : ''}${customMessage ? ` Message: "${customMessage}"` : ''}`;

		if (sub === 'live') {
			const streamer = await resolveStreamer(target);
			if (!streamer) {
				// sb-v2 speicherte trotzdem ("notification saved, but ...") - ohne Twitch-ID kann hier nichts abonniert werden
				return { text: `@${display}, ${target} could not be resolved — please check the name.` };
			}

			await bot.DB.NotifyLive.updateOne(
				{ channel: channel.id, streamerId: streamer.id },
				{ $set: { streamerLogin: streamer.login, message: customMessage, times }, $setOnInsert: { added: new Date() } },
				{ upsert: true },
			);
			// Sofort abonnieren, sonst greift es erst mit notify-resync
			watchStreamer(streamer.id);
			watchTitle(streamer.id);
			console.log(`[notify] live ${streamer.login} in #${channel.name}`);
			return { text: `@${display}, ✅ Live notification for ${target} added.${extra}` };
		}

		await bot.DB.NotifyBan.updateOne(
			{ channel: channel.id, login: target },
			{ $set: { message: customMessage, notified: null }, $setOnInsert: { added: new Date() } },
			{ upsert: true },
		);
		console.log(`[notify] ban ${target} in #${channel.name}`);
		return { text: `@${display}, ✅ Watching ${target} for Twitch bans.${extra}` };
	},
};
