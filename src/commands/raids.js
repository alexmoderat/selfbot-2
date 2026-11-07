const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getRaidSummary } = require('../services/channel-stats.js');
const { formatShortDate } = require('../misc/tracking-format.js');

/** Groesster eingehender Raid und Anzahl Raids (Modul raid-tracking), aus sb-v2 */
module.exports = {
	name: 'raids',
	aliases: ['topraid'],
	cooldown: 3000,
	description: 'Biggest incoming raid a channel has received, and how many raids total. Defaults to the current channel.',
	usage: 'raids [channel]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const name = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = name === msg.channelData?.name;
		const user = name ? await fetchTwitchUser(name).catch(() => null) : null;
		if (!user) {
			return { text: `@${display}, no Twitch account named "${name}" exists.` };
		}

		const summary = await getRaidSummary(user.id);
		if (!summary) {
			return {
				text: `@${display}, no raids recorded yet for ${own ? 'this channel' : `#${name}`} — either tracking just started, or that's not a channel I watch.`,
			};
		}

		const word = summary.count === 1 ? 'raid' : 'raids';
		return {
			text: `@${display}, ${name}'s biggest raid: @${summary.Raider_Login} with ${summary.Viewer_Count} viewers (${formatShortDate(summary.Seen_At)}) — ${summary.count} ${word} received total`,
		};
	},
};
