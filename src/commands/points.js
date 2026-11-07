const { getChannelPointsBalance } = require('../misc/twitch-gql.js');

/** Kanalpunkte des Web-Token-Accounts in einem Channel, aus sb-v2 - braucht TWITCH_WEB_TOKEN (kein OAuth-Scope dafuer) */
module.exports = {
	name: 'points',
	aliases: ['channelpoints'],
	cooldown: 3000,
	description: "Shows the bot account's channel points balance in a channel.",
	usage: 'points [channel]',
	flags: ['owner'],
	execute: async (client, msg) => {
		const [channelArg] = msg.args;
		const display = msg.displayName;
		const channel = (channelArg ?? msg.channelData?.name ?? '').replace(/^#+/, '').toLowerCase();
		if (!process.env.TWITCH_WEB_TOKEN) {
			return { text: `@${display}, webToken not configured — this feature needs a web session token (TWITCH_WEB_TOKEN).` };
		}

		const balance = await getChannelPointsBalance(channel);
		if (balance === null) {
			return { text: `@${display}, could not fetch points balance for #${channel} (token expired or GQL error, see logs).` };
		}
		return { text: `@${display}, ${balance.toLocaleString('en-US')} channel points in #${channel}.` };
	},
};
