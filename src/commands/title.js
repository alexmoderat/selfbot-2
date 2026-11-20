const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { fetchChannelInfo } = require('../token/twitch-info.js');

/** Titel und Kategorie eines beliebigen Channels, nur zum Anzeigen (sb-v2, ninou2, 06.10.2026: "make check a streamer title") */
module.exports = {
	name: 'title',
	cooldown: 3000,
	description: 'Shows the stream title and category of a channel. Defaults to the current channel. To change it, use settitle.',
	usage: 'title [channel]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const channel = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const user = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		const info = user ? await fetchChannelInfo(user.id).catch(() => null) : null;
		if (!info) {
			return { text: `@${display}, no channel named "${channel}" found.` };
		}

		return { text: `@${display}, ${channel}'s title: " ${info.title} "${info.game ? ` (Category: ${info.game})` : ''}` };
	},
};
