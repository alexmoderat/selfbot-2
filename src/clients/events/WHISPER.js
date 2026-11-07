const { client } = require('../../util/twitch/connections.js');
const { Logger, LogLevel } = require('../../misc/logger.js');

// Whispers kommen ueber IRC nur noch eingeschraenkt an (Twitch); nur protokollieren wie bei DontAddThisBot
const WHISPER = async function () {
	client.on('WHISPER', ({ messageText, senderUsername }) => {
		Logger.log(LogLevel.DEBUG, `[whisper] ${senderUsername}: ${messageText}`);
	});
};

module.exports = { WHISPER };
