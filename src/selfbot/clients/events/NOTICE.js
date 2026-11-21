const { client } = require('../../util/twitch/connections.js');
const ChatModules = require('../modules/chat-modules.js');

// Wie DontAddThisBot: Kanal-Hinweise (gebannt, gesperrt, Nachricht abgelehnt). Die Behandlung selbst
// (Channel inaktiv setzen usw.) uebernimmt das Chat-Modul channel-suspension ueber "channelState".

const STATE_IDS = new Set(['msg_banned', 'msg_channel_suspended', 'msg_rejected_mandatory', 'msg_followersonly', 'msg_subsonly', 'msg_verified_email', 'msg_requires_verified_phone_number']);

const NOTICE = async function () {
	client.on('NOTICE', ({ channelName, messageID, messageText }) => {
		if (!messageID || !channelName) {
			return;
		}

		if (STATE_IDS.has(messageID)) {
			const channel = bot.Channels.get(channelName);
			if (channel) {
				ChatModules.dispatch('channelState', { channel, msgId: messageID, text: messageText });
			}
		}
	});
};

module.exports = { NOTICE };
