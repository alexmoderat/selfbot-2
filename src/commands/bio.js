const { getUserProfile } = require('../misc/twitch-gql.js');

/** Bio eines beliebigen Channels, Standard der aktuelle (sb-v2, ninou2, 06.10.2026) */
const MAX_LEN = 400;

module.exports = {
	name: 'bio',
	cooldown: 3000,
	description: "Shows a channel's bio (profile description). Defaults to the current channel; works for any channel.",
	usage: 'bio [channel]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const channel = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const info = channel ? await getUserProfile(channel) : null;
		if (!info?.id) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const text = (info.bio ?? '').trim().replace(/\s+/g, ' ');
		if (!text) {
			return { text: `@${display}, ${channel} has no bio.` };
		}

		return { text: `@${display}, ${channel}'s bio: ${text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 3)}...` : text}` };
	},
};
