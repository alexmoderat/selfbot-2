const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');

/**
 * Jede Chatnachricht ins Log (pm2) und die letzten 60 in einen Ringpuffer fuer die Statusseite (Block 9), aus sb-v2.
 * Standardmaessig aus (bei vielen Channels tausende Zeilen pro Minute): CHAT_LOG=1, CHAT_LOG_RAW=1 fuer die Rohdaten.
 */
const ENABLED = process.env.CHAT_LOG === '1';
const RAW_ENABLED = process.env.CHAT_LOG_RAW === '1';
const MAX_RECENT = 60;

const recent = [];

const recentChat = () => recent;

module.exports = defineChatModule({
	name: 'chat-console-log',
	description: 'Writes every chat message to the log and a ring buffer for the status page. Off by default (CHAT_LOG=1).',
	scope: 'global',
	handlers: {
		message: (context) => {
			if (!ENABLED) {
				return;
			}

			const { channel, user, message, data } = context;
			Logger.info(`[Chat] #${channel.name} ${user.name}: ${message}`);
			if (RAW_ENABLED) {
				Logger.info(`[ChatRaw] #${channel.name} ${user.name}: ${JSON.stringify(data)}`);
			}

			recent.unshift({ channel: channel.name, user: user.name, message, ts: Date.now() });
			if (recent.length > MAX_RECENT) {
				recent.length = MAX_RECENT;
			}
		},
	},
});

Object.assign(module.exports, { recentChat });
