const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { runNetworkBotCheck } = require('../services/network-bot-detector.js');
const { getRule } = require('../misc/network-bot-rules.js');

// CatQuery-Muster "sm" aus sb-v2 - Schwellen und Begruendungen in utils/network-bot-rules.ts
const RULE = getRule('sm');

module.exports = defineChatModule({
	name: 'social-media-scammer-bot',
	description: 'Bans accounts whose follower-growth/social-media first message appears in 3+ (new accounts: 2+) channels within 10 minutes.',
	scope: 'global',
	handlers: {
		message: async (context) => await runNetworkBotCheck(context, RULE),
	},
});
