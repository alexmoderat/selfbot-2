const { fetchModeratedChannels, fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getSuspension, suspendChannel } = require('./channel-suspension.js');

// Channels betreten und verlassen, aus sb-v2s singletons/channels.ts (join/part/findMissing). Im selfbot heisst
// "betreten": Channel-Eintrag aktiv (Mode Moderator, wo der Bot moddet, sonst Write) und EventSub/PubSub abonniert.
// "verlassen": Mode Inactive mit inactive.reason = "manual" - dann holt ihn weder auto-join noch ban-check zurueck
// (sb-v2: parted_channels mit Grund "manual", Vorfall #wiihxhx, 01.08.2026).

const getTwitch = () => bot.Twitch;

/** Der eigene Channel des Bot-Kontos wird nie verlassen */
const isProtected = (channel) => channel.name === getTwitch().selfName;

const moderatedIds = async () => {
	const list = await fetchModeratedChannels(getTwitch().selfId);
	return list ? new Set(list.map((i) => i.id)) : null;
};

const joinByLogin = async (login) => {
	const platform = getTwitch();
	const user = await fetchTwitchUser(login);
	if (!user) {
		return { status: 'notfound' };
	}

	let channel = bot.Channels.getByTwitchId(user.id) ?? bot.Channels.get(user.login);
	if (channel && channel.mode !== 'Inactive') {
		return { status: 'already', channel };
	}

	const mods = await moderatedIds();
	const mode = mods?.has(user.id) || user.id === platform.selfId ? 'Moderator' : 'Write';
	if (!channel) {
		channel = await bot.Channels.add(user.login, platform, mode, user.id);
	} else {
		if (channel.name !== user.login) {
			await bot.Channels.saveProperty(channel, 'Name', user.login);
		}

		await bot.Channels.setData(channel, 'inactive', null);
		await bot.Channels.saveProperty(channel, 'Mode', mode);
	}

	await platform.joinChannel(channel);
	return { status: 'joined', channel, mode };
};

/**
 * Nachrichten nach dem Beitritt ueber die Website (ninou2, 03.11.2026): ohne Haekchen zuerst der Mod-Hinweis ("@Alexmoderat has
 * joined your channel, for the best use of the commands and features type in the chat: /mod Alexmoderat"), dann die Befehle und das Prefix.
 */
const JOIN_MESSAGE_DELAY = 4000;
const joinMessages = (botName, isMod, prefix) => [
	isMod
		? `@${botName} bot has joined your channel and is ready to use!`
		: `@${botName} bot has joined your channel, for the best use of the bot commands and features type in the chat: /mod ${botName}`,
	`To use the bot commands type: ${prefix} CommandName. All commands can be found here: https://auth.alexmoderat.eu/dashboard#settings`,
	`To use the bot commands and features, the trigger prefix is "${prefix}", example of use: ${prefix} CommandName. You can change this prefix "${prefix}" to any new word/symbol using this command: ${prefix} setprefix YourWord/symbol (max 3 characters). Example of use: ${prefix} setprefix ! , ${prefix} setprefix + , ${prefix} setprefix bot`,
];

/** Bot ist gerade Mod geworden: Mode setzen und die Mod-Abos nachziehen */
const markModerator = async (channel) => {
	await bot.Channels.saveProperty(channel, 'Mode', 'Moderator');
	await getTwitch().joinChannel(channel);
};

/** Manuell verlassen (part) */
const partChannel = async (channel) => await suspendChannel(channel, 'manual');

/**
 * Mod-Channels des Bot-Kontos, in denen er nicht aktiv ist - ausser manuell verlassene und gesperrte
 * (sb-v2: findMissing). null, wenn Twitch die Liste nicht liefert.
 */
const findMissing = async () => {
	const platform = getTwitch();
	const list = await fetchModeratedChannels(platform.selfId);
	if (!list) {
		return null;
	}

	const missing = [];
	for (const item of list) {
		const channel = bot.Channels.getByTwitchId(item.id);
		if (!channel) {
			missing.push(item);
			continue;
		} else if (channel.mode !== 'Inactive') {
			continue;
		}

		// Gesperrte holt ban-check zurueck, manuell verlassene bleiben draussen
		const inactive = await getSuspension(channel);
		if (!inactive) {
			missing.push(item);
		}
	}

	return missing;
};

/**
 * Mode an den Mod-Status des Bots anpassen: Moderator <-> Write, PubSub neu (Mod-Topics nur mit Mod-Rechten).
 * false, wenn der Mode schon stimmt.
 */
const setModerator = async (channel, isMod) => {
	const mode = isMod ? 'Moderator' : 'Write';
	if (channel.mode === mode) {
		return false;
	}

	const previous = channel.mode;
	await bot.Channels.saveProperty(channel, 'Mode', mode);
	bot.PubSub?.unsubscribeChannel(channel);
	bot.PubSub?.subscribeChannel(channel);
	console.log(`[channels] #${channel.name}: ${previous} -> ${mode}`);
	return true;
};

// Mehr Wechsel auf einmal sind eher eine unvollstaendige Helix-Antwort als echte Mod-Wechsel
const MAX_MODE_CHANGES = 20;

/**
 * Mode aller aktiven Channels mit Helix "moderated channels" abgleichen (auto-join, alle 2 min). Read-Channels und der
 * eigene Channel bleiben, wie sie sind.
 */
const syncModeratorModes = async () => {
	const mods = await moderatedIds();
	if (!mods) {
		return null;
	}

	const changes = [];
	for (const channel of bot.Channels.getJoinable()) {
		if (isProtected(channel) || !channel.twitchId || channel.mode === 'Read') {
			continue;
		}

		const isMod = mods.has(channel.twitchId);
		if (isMod !== (channel.mode === 'Moderator')) {
			changes.push({ channel, isMod });
		}
	}

	if (changes.length > MAX_MODE_CHANGES) {
		console.warn(`[channels] ${changes.length} Mod-Wechsel auf einmal - uebersprungen (Helix-Antwort unvollstaendig?)`);
		return null;
	}

	for (const { channel, isMod } of changes) {
		await setModerator(channel, isMod);
	}
	return changes;
};

/** Aktive Channels, in denen der Bot nicht (mehr) Mod ist - ohne den eigenen (sb-v2: extrachannels) */
const findExtra = async () => {
	const platform = getTwitch();
	const mods = await moderatedIds();
	if (!mods) {
		return null;
	}

	return bot.Channels.getJoinable().filter((i) => !mods.has(i.twitchId ?? '') && !isProtected(i));
};

module.exports = {
	isProtected,
	joinByLogin,
	JOIN_MESSAGE_DELAY,
	joinMessages,
	markModerator,
	partChannel,
	findMissing,
	findExtra,
	setModerator,
	syncModeratorModes,
};
