const { commands } = require('../clients/modules/commands.js');
const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { CHANNEL_LIVE_SUBSCRIPTION_TITLE } = require('../commands/subscribe.js');

/** Supibots chat-modules/live-detection: Whisper an alle mit "subscribe live" auf diesen Channel, wenn er live geht */

module.exports = defineChatModule({
	name: 'live-detection',
	description: 'Sends out PMs to all users subbed to the live event, whenever a channel set up there goes live.',
	scope: 'global',
	handlers: {
		online: async (context) => {
			const { channel, platform } = context;
			const subscriptions = await core.Query.getRecordset((rs) =>
				rs // TODO(port)
					.select('User_Alias AS userId')
					.from('selfbot_data', 'Event_Subscription')
					.where('Active = %b', true)
					.where('Type = %s', CHANNEL_LIVE_SUBSCRIPTION_TITLE)
					.where('JSON_CONTAINS(Data, %s, %s) = %n', String(channel.id), '$.channels', 1),
			);

			for (const { userId } of subscriptions) {
				const userData = await bot.Users.get(userId);
				if (userData) {
					void platform.pm(`Channel ${channel.name} has just gone live! https://twitch.tv/${channel.name}`, userData);
				}
			}
		},
	},
});
