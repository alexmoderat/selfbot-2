const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { formatTopClip, topByViews } = require('../misc/topclips.js');
const { packLines, replyInChunks } = require('../misc/tracking-format.js');
const { fetchClips } = require('../misc/twitch-info.js');

/** Die 5 meistgesehenen Clips des Channels, aller Zeiten (ninou2, 04.10.2026), lokal sortiert, aus sb-v2 */
const COUNT = 5;
const FETCH = 100;
const MSG_LIMIT = 450;

module.exports = {
	name: 'topclip',
	aliases: ['topclips'],
	cooldown: 3000,
	description: 'Top 5 most-viewed clips of the current channel, all time (split over a few messages).',
	usage: 'topclip',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const channel = (msg.channelData?.name ?? '').toLowerCase();

		const user = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		if (!user) {
			return { text: `@${display}, failed to get broadcaster ID.` };
		}

		const list = await fetchClips(user.id, FETCH);
		if (list.length === 0) {
			return { text: `@${display}, #${channel} has no clips yet.` };
		}

		const top = topByViews(list, COUNT);
		const head = `@${display}, top ${top.length} clips in #${channel}: `;
		return await replyInChunks(
			msg,
			packLines(
				head,
				top.map((i, index) => formatTopClip(index + 1, i)),
				MSG_LIMIT,
			),
		);
	},
};
