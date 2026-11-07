const { fetchModeratedChannels } = require('../util/twitch/twitch-utils.js');
const { uploadList } = require('../misc/haste.js');

/**
 * Liste der Channels, in denen der Bot aktiv ist (Anzahl + Link), aus sb-v2 (alexmoderat, 03.10.2026: ninou2 probierte
 * !joined und !channellist). Quelle: Mod-Channels des Bot-Kontos (Helix) plus die aktiven Channels; der eigene zaehlt mit.
 */
module.exports = {
	name: 'channellist',
	aliases: ['joined', 'channels'],
	cooldown: 3000,
	description: 'Lists the channels the bot is active in (count plus a link to the full list).',
	usage: 'channellist',
	flags: ['mod'],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const platform = bot.Twitch;
		const mods = (await fetchModeratedChannels(platform.selfId).catch(() => null)) ?? [];

		const all = new Set([platform.selfName]);
		for (const name of [...mods.map((i) => i.login), ...bot.Channels.getJoinable().map((i) => i.Name)]) {
			all.add(name.toLowerCase());
		}

		const sorted = [...all].sort((a, b) => a.localeCompare(b));
		try {
			const url = await uploadList(`Channels the bot is active in (${sorted.length})`, sorted);
			return { text: `@${display}, I am active in ${sorted.length} channels: ${url}` };
		} catch {
			return { text: `@${display}, I am active in ${sorted.length} channels (upload failed).` };
		}
	},
};
