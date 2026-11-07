const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { fetchClips } = require('../misc/twitch-info.js');

/** Meistgesehener der letzten Clips eines Channels ueber Helix "Get Clips", aus sb-v2 (alexmoderat, 29.09.2026) */
module.exports = {
	name: 'clips',
	aliases: ['clip'],
	cooldown: 3000,
	description: 'Shows the most-viewed recent clip of a channel. Defaults to the current channel.',
	usage: 'clips [channel]',
	execute: async (client, msg) => {
		const [channelRaw] = msg.args;
		const display = msg.displayName;
		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const user = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		if (!user) {
			return { text: `@${display}, channel "${channel}" not found.` };
		}

		const list = await fetchClips(user.id);
		if (list.length === 0) {
			return { text: `@${display}, #${channel} has no clips.` };
		}

		const top = list.reduce((a, b) => (b.view_count > a.view_count ? b : a));
		return {
			text:
				`@${display}, top clip for #${channel}: "${top.title}" by ${top.creator_name} ` +
				`— ${top.view_count.toLocaleString('en-US')} views — ${top.url}`,
		};
	},
};
