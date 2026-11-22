const { describeFailure, updateBroadcastSettings } = require('../util/broadcast-settings.js');
const { fetchChannelInfo } = require('../token/twitch-info.js');

/** Stream-Titel des aktuellen Channels setzen, ohne Argument anzeigen (ninou2, 17.09.2026), aus sb-v2 */
const command = {
	name: 'settitle',
	aliases: ['titlechange', 'tch'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Sets the stream title of the current channel, or shows the current one without an argument.',
	usage: 'settitle [new title]',
	flags: ['no-prefix'],
	execute: async ({ client, message: msg }) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		const title = words.join(' ').trim();
		if (!title) {
			const info = channel.twitchId ? await fetchChannelInfo(channel.twitchId).catch(() => null) : null;
			if (!info) {
				return `@${display}, Usage: ${msg.invocation} <new title>`;
			}
			return `@${display}, current title: "${info.title}"${info.game ? ` (Category: ${info.game})` : ''}`;
		}

		const result = await updateBroadcastSettings(channel, { title });
		if (!result.ok) {
			return describeFailure(result, display);
		}

		// ninou2, 06.10.2026: "add plese what the new title is"
		return `@${display}, title updated: " ${title} "`;
	},
};

module.exports = { command };
