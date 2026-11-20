const { client } = require('../../util/twitch/connections.js');
const ChatModules = require('../modules/chat-modules.js');

// Sub, Resub, Gift, Raid, Watch-Streak, ... an die Chat-Module (sub-announce, raid-shoutout, watch-streak-*)

const USERNOTICE = () => {
	client.on('USERNOTICE', (msg) => {
		// Shared Chat: nur am Ursprung
		const source = msg.ircTags['source-room-id'];
		if (source && source !== msg.channelID) {
			return;
		}

		const channel = bot.Channels.getByTwitchId(msg.channelID);
		ChatModules.dispatch('usernotice', {
			channel,
			channelId: msg.channelID,
			channelName: msg.channelName,
			msgId: msg.messageTypeID,
			userId: msg.senderUserID ?? '',
			userName: (msg.senderUsername ?? '').toLowerCase(),
			tags: msg.ircTags,
			text: msg.messageText ?? '',
		});
	});
};

module.exports = { USERNOTICE };
