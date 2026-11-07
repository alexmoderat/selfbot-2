const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');

const JOIN = async function () {
	client.on('JOIN', ({ channelName, joinedUsername }) => {
		if (joinedUsername === client.configuration.username) {
			Logger.log(LogLevel.DEBUG, `Joined channel ${channelName}`);
		}
	});
};

module.exports = { JOIN };
