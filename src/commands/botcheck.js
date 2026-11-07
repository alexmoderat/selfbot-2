const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { banUser, targetFromChannel } = require('../services/moderation.js');
const botList = require('../services/twitchinsights-bots.js');

/**
 * Abgleich mit der TwitchInsights-Botliste, aus sb-v2.
 *   botcheck <user>   nachsehen
 *   botban <user>     bannen, wenn er drinsteht - nur im Sammel-Channel, sonst waere ein Vertipper teuer
 */
const BOTBAN_CHANNEL = 'alex_sbottats';
const EXCLUDED = new Set(['tackling']);

module.exports = {
	name: 'botcheck',
	aliases: ['botban'],
	cooldown: 3000,
	description: 'Checks the TwitchInsights bot list; botban bans a listed bot.',
	usage: 'botcheck <user> | botban <user>',
	flags: ['mod'],
	initialize: async () => {
		await botList.initialize();
	},
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const target = targetRaw
			?.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
		if (!target) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <user>` };
		}

		const isListed = botList.isListedBot(target);
		if (msg.invocation === 'botcheck') {
			return { text: `@${display}, ${target} ${isListed ? 'is' : 'is NOT'} on the TwitchInsights bot list.` };
		}

		if (EXCLUDED.has(target)) {
			return { text: `@${display}, ${target} is excluded.` };
		} else if (msg.channelData?.name !== BOTBAN_CHANNEL) {
			return { text: `@${display}, botban only works in #${BOTBAN_CHANNEL}.` };
		} else if (!isListed) {
			return { text: `@${display}, ${target} is not on the bot list.` };
		}

		const user = await fetchTwitchUser(target);
		if (!user) {
			return { text: `@${display}, user not found.` };
		}

		const ok = await banUser(targetFromChannel(msg.channelData, user.id, user.login), {
			reason: 'TwitchInsights bot list. automated by alexmoderat',
			status: 'BOTBAN',
		});
		return { text: ok ? `@${display}, ${target} banned.` : `@${display}, ban failed for ${target}.` };
	},
};
