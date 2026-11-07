const { defineChatModule } = require('../clients/modules/chat-modules.js');

/**
 * Sub-/Resub-/Gift-Ansage, opt-in je Channel (submessage on), aus sb-v2 (ninou2, 13.08./11.09.2026). Beim Gift ist
 * {user} der Gifter und {receiver} (auch {reciever}) der Empfaenger.
 */
const DEFAULT_SUB_MESSAGE = '@{user}, thanks for the sub!';
const DEFAULT_GIFT_MESSAGE = '@{user}, thank you for gifting a sub to @{receiver}!';

const formatSubText = (template, user) => template.replaceAll('{user}', user);
const formatGiftText = (template, gifter, receiver) =>
	template
		.replaceAll('{user}', gifter)
		.replaceAll(/\{reciever\}/gi, receiver)
		.replaceAll(/\{receiver\}/gi, receiver);

module.exports = defineChatModule({
	name: 'sub-announce',
	description: 'Posts an announcement for new subs, resubs and gift subs (opt-in via submessage).',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags } = context;
			if (msgId !== 'sub' && msgId !== 'resub' && msgId !== 'subgift') {
				return;
			}
			if ((await bot.Channels.getData(channel, 'subMessage')) !== true) {
				return;
			}

			const name = String(tags['display-name'] ?? '') || String(tags.login ?? '');
			let text;
			if (msgId === 'subgift') {
				const receiver = String(tags['msg-param-recipient-display-name'] ?? '') || String(tags['msg-param-recipient-user-name'] ?? '') || name;
				text = formatGiftText((await bot.Channels.getData(channel, 'subGiftMessageText')) || DEFAULT_GIFT_MESSAGE, name, receiver);
			} else {
				text = formatSubText((await bot.Channels.getData(channel, 'subMessageText')) || DEFAULT_SUB_MESSAGE, name);
			}

			await bot.Channels.send(channel, text);
			console.log(`[sub-announce] Ansage (${msgId}) fuer ${name} in #${channel.name}`);
		},
	},
});

Object.assign(module.exports, { DEFAULT_SUB_MESSAGE, DEFAULT_GIFT_MESSAGE, formatSubText, formatGiftText });
