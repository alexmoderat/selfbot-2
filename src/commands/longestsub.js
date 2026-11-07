const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getLongestSub } = require('../services/channel-stats.js');

/** Hoechste je gesehene Sub-Monate eines Users (chat_data.longest_sub, vom autojoin-bot gefuellt), aus sb-v2 */
module.exports = {
	name: 'longestsub',
	cooldown: 3000,
	description: 'Shows the highest sub-months count ever seen for a user (any channel, from resub announcements across the CatQuery firehose).',
	usage: 'longestsub [user]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [userRaw] = msg.args;
		const display = msg.displayName;
		const login = (userRaw ?? msg.sender.name).replace(/^@/, '').toLowerCase();
		const user = await fetchTwitchUser(login).catch(() => null);
		if (!user) {
			return { text: `@${display}, no Twitch account named "${login}" exists.` };
		}

		const entry = await getLongestSub(user.id);
		if (!entry) {
			return { text: `@${display}, no resub data seen for ${login} yet.` };
		}

		const months = Number(entry.max_months);
		return { text: `@${display}, @${entry.username} has been subbed for ${months} month${months === 1 ? '' : 's'} (longest seen, in #${entry.channel}).` };
	},
};
