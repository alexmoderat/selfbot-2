const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');
const ChatModules = require('../modules/chat-modules.js');

// Bans, Timeouts und /clear an die Chat-Module (mod-actions-log, ban-watch, ...).
// Wie DontAddThisBot: wird der Bot selbst gebannt oder getimeoutet, als WARN ins Log.

const CLEARCHAT = async function () {
	client.on('CLEARCHAT', (msg) => {
		const { targetUsername, channelName, ircTags, banDuration } = msg;
		if (targetUsername && targetUsername === client.configuration.username) {
			const what = banDuration ? `Timed out for ${banDuration}s` : 'Banned';
			Logger.log(LogLevel.WARN, `${what} in ${channelName}: ${targetUsername}`, ircTags['room-id']);
		}

		const channel = bot.Channels.getByTwitchId(msg.channelID ?? ircTags['room-id']);
		ChatModules.dispatch('clearchat', {
			channel,
			channelName,
			targetUsername: targetUsername ?? null,
			targetUserId: ircTags['target-user-id'] ?? null,
			banDuration: banDuration ?? null,
			tags: ircTags,
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
