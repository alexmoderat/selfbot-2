const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');

// Watch-Channels (aus sb-v2s !watch): Channels, die der Bot ohne Mod-Status mitliest. Im selfbot ist das ein
// Channel mit Mode "Read" (Supibot-Modell: liest, antwortet nicht). Entfernen setzt ihn auf "Inactive" -
// Channels mit einem anderen Mode (Moderator, Write, ...) bleiben unangetastet.

const getTwitch = () => bot.Twitch;

const listWatchChannels = () => [...bot.Channels.all()].filter((i) => i.mode === 'Read');

const addWatchChannel = async (login) => {
	const platform = getTwitch();
	const existing = bot.Channels.get(login);
	if (existing && existing.mode !== 'Inactive' && existing.mode !== 'Read') {
		return { ok: false, reason: 'active', channel: existing };
	}

	const user = await fetchTwitchUser(login);
	if (!user) {
		return { ok: false, reason: 'notfound' };
	}

	// Umbenannt: per ID schon bekannt
	let channel = existing ?? bot.Channels.getByTwitchId(user.id);
	if (channel && channel.mode !== 'Inactive' && channel.mode !== 'Read') {
		return { ok: false, reason: 'active', channel };
	}

	const created = !channel;
	if (!channel) {
		channel = await bot.Channels.add(user.login, platform, 'Read', user.id);
	} else if (channel.mode !== 'Read') {
		await bot.Channels.saveProperty(channel, 'Mode', 'Read');
	}

	await platform.joinChannel(channel);
	return { ok: true, channel, created };
};

/** false, wenn der Channel kein Watch-Channel war */
const removeWatchChannel = async (login) => {
	const channel = bot.Channels.get(login, getTwitch());
	if (channel?.mode !== 'Read') {
		return false;
	}

	await bot.Channels.saveProperty(channel, 'Mode', 'Inactive');
	await getTwitch().leaveChannel(channel);
	return true;
};

module.exports = { listWatchChannels, addWatchChannel, removeWatchChannel };
