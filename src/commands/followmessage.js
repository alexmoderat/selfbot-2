const { DEFAULT_FOLLOW_MESSAGE } = require('../clients/modules/chat/follow-announce.js');

/** Follow-Ansage im Chat verwalten (Modul follow-announce), opt-in je Channel, aus sb-v2 */
const command = {
	name: 'followmessage',
	aliases: ['followmsg'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Manages the chat announcement posted on new follows.',
	usage: 'followmessage on | off | set <text with {user}>',
	execute: async ({ client, message: msg }) => {
		const [sub, ...rest] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		}

		if (!sub) {
			const enabled = (await bot.Channels.getData(channel, 'followMessage')) === true;
			const message = (await bot.Channels.getData(channel, 'followMessageText')) || DEFAULT_FOLLOW_MESSAGE;
			return `@${display}, follow messages are ${enabled ? 'ON' : 'OFF'}. Current text: "${message}"`;
		}

		const action = sub.toLowerCase();
		if (action === 'on' || action === 'off') {
			await bot.Channels.setData(channel, 'followMessage', action === 'on');
			if (action === 'on') {
				await bot.Twitch.subscribeFollows(channel).catch(() => false);
			}
			return `@${display}, follow messages turned ${action.toUpperCase()}.`;
		}

		if (action === 'set') {
			const text = rest.join(' ').trim();
			if (!text) {
				return `@${display}, Usage: ${msg.invocation} set <text with {user}>`;
			}
			await bot.Channels.setData(channel, 'followMessageText', text);
			return `@${display}, follow message updated: "${text}"`;
		}

		return `@${display}, Usage: ${msg.invocation} on | off | set <text with {user}>`;
	},
};

module.exports = { command };
