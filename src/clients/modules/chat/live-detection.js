const { defineChatModule } = require('../chat-modules.js');
const { CHANNEL_LIVE_SUBSCRIPTION_TITLE } = require('../../../commands/subscribe.js');

/** Supibots chat-modules/live-detection: Whisper an alle mit "subscribe live" auf diesen Channel, wenn er live geht */

module.exports = defineChatModule({
	name: 'live-detection',
	description: 'Sends out PMs to all users subbed to the live event, whenever a channel set up there goes live.',
	scope: 'global',
	handlers: {
		online: async (context) => {
			const { channel, platform } = context;
			// data ist JSON-Text { channels: [IDs] } (wie in MariaDB); JSON_CONTAINS hier in JS
			const parse = (raw) => {
				try {
					return JSON.parse(raw ?? '{}');
				} catch {
					return {};
				}
			};
			const subscriptions = (await bot.DB.EventSubscription.find({ active: true, type: CHANNEL_LIVE_SUBSCRIPTION_TITLE }, { userAlias: 1, data: 1 }).lean())
				.filter((i) => (parse(i.data).channels ?? []).map(Number).includes(channel.id))
				.map((i) => ({ userId: i.userAlias }));

			for (const { userId } of subscriptions) {
				const userData = await bot.Users.get(userId);
				if (userData) {
					void platform.pm(`Channel ${channel.name} has just gone live! https://twitch.tv/${channel.name}`, userData);
				}
			}
		},
	},
});
