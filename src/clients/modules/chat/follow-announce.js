const { defineChatModule } = require('../chat-modules.js');

/** Follow-Ansage, opt-in je Channel (followmessage on), aus sb-v2s follow-announce; {user} = neuer Follower */
const DEFAULT_FOLLOW_MESSAGE = '@{user}, thanks for the follow!';

module.exports = defineChatModule({
	name: 'follow-announce',
	description: 'Posts a thank-you message for new followers (opt-in via followmessage).',
	scope: 'global',
	handlers: {
		follow: async (context) => {
			const { channel } = context;
			if ((await bot.Channels.getData(channel, 'followMessage')) !== true) {
				return;
			}

			const template = (await bot.Channels.getData(channel, 'followMessageText')) || DEFAULT_FOLLOW_MESSAGE;
			await bot.Channels.send(channel, template.replaceAll('{user}', context.userDisplayName || context.userName));
		},
	},
});

Object.assign(module.exports, { DEFAULT_FOLLOW_MESSAGE });
