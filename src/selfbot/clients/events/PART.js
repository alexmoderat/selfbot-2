const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');

const PART = async function () {
	client.on('PART', ({ channelName, partedUsername }) => {
		if (partedUsername === client.configuration.username) {
			Logger.log(LogLevel.WARN, `Left channel ${channelName}`);
		}
	});
};

module.exports = { PART };
