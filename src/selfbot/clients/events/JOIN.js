const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');

// Wie DontAddThisBot: jeder eigene Join als INFO
const JOIN = async function () {
	client.on('JOIN', ({ channelName, joinedUsername }) => {
		if (joinedUsername === client.configuration.username) {
			Logger.log(LogLevel.INFO, `Joined channel ${channelName}`);
		}
	});
};

module.exports = { JOIN };
