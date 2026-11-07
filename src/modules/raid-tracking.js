const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { recordRaid } = require('../services/channel-stats.js');

/** Eingehende Raids aufzeichnen (fuer !raids), aus sb-v2 */
module.exports = defineChatModule({
	name: 'raid-tracking',
	description: 'Records incoming raids (for raids).',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags } = context;
			const login = String(tags['msg-param-login'] ?? '');
			if (msgId !== 'raid' || !login || !channel.twitchId) {
				return;
			}

			const display = String(tags['msg-param-displayName'] || login);
			await recordRaid(channel, login, display, Number(tags['msg-param-viewerCount'] ?? 0)).catch((e) =>
				console.warn(`[raid-tracking] ${login} in #${channel.name}`, e),
			);
		},
	},
});
