const { client } = require('../../util/twitch/connections.js');
const ChatModules = require('../modules/chat-modules.js');

// Bans, Timeouts und /clear an die Chat-Module (mod-actions-log, ban-watch, ...)

const CLEARCHAT = async function () {
	client.on('CLEARCHAT', (msg) => {
		const channel = bot.Channels.getByTwitchId(msg.channelID ?? msg.ircTags['room-id']);
		ChatModules.dispatch('clearchat', {
			channel,
			channelName: msg.channelName,
			targetUsername: msg.targetUsername ?? null,
			targetUserId: msg.ircTags['target-user-id'] ?? null,
			banDuration: msg.banDuration ?? null,
			tags: msg.ircTags,
		});
	});

	client.on('CLEARMSG', (msg) => {
		const channel = bot.Channels.get(msg.channelName);
		ChatModules.dispatch('clearmsg', {
			channel,
			channelName: msg.channelName,
			targetUsername: msg.targetUsername,
			targetMessageId: msg.targetMessageID,
			text: msg.targetMessageContent,
			tags: msg.ircTags,
		});
	});
};

module.exports = { CLEARCHAT };
