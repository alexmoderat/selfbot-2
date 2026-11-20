const { DEFAULT_GIFT_MESSAGE, DEFAULT_SUB_MESSAGE } = require('../clients/modules/chat/sub-announce.js');

/**
 * Sub-Ansage im Chat verwalten (Modul sub-announce), opt-in je Channel, aus sb-v2. "set gift": {user} = Gifter,
 * {receiver} = Empfaenger (ninou2, 11.09.2026).
 */
module.exports = {
	name: 'submessage',
	aliases: ['submsg'],
	cooldown: 3000,
	description: 'Manages the chat announcement posted on new subs/resubs/gift-subs.',
	usage: 'submessage on | off | set <text with {user}> | set gift <text with {user}=gifter, {receiver}=recipient>',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [sub, ...rest] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		if (!sub) {
			const enabled = (await bot.Channels.getData(channel, 'subMessage')) === true;
			const message = (await bot.Channels.getData(channel, 'subMessageText')) || DEFAULT_SUB_MESSAGE;
			const giftMessage = (await bot.Channels.getData(channel, 'subGiftMessageText')) || DEFAULT_GIFT_MESSAGE;
			return { text: `@${display}, sub messages are ${enabled ? 'ON' : 'OFF'}. Sub/resub: "${message}" — Gift: "${giftMessage}"` };
		}

		const action = sub.toLowerCase();
		if (action === 'on' || action === 'off') {
			await bot.Channels.setData(channel, 'subMessage', action === 'on');
			return { text: `@${display}, sub messages turned ${action.toUpperCase()}.` };
		}

		if (action === 'set') {
			if (rest[0]?.toLowerCase() === 'gift') {
				const text = rest.slice(1).join(' ').trim();
				if (!text) {
					return { text: `@${display}, Usage: ${msg.invocation} set gift <text with {user}=gifter, {receiver}=recipient>` };
				}
				await bot.Channels.setData(channel, 'subGiftMessageText', text);
				return { text: `@${display}, gift sub message updated: "${text}"` };
			}

			const text = rest.join(' ').trim();
			if (!text) {
				return { text: `@${display}, Usage: ${msg.invocation} set <text with {user}>` };
			}
			await bot.Channels.setData(channel, 'subMessageText', text);
			return { text: `@${display}, sub message updated: "${text}"` };
		}

		return { text: `@${display}, Usage: ${msg.invocation} on | off | set <text with {user}> | set gift <text>` };
	},
};
