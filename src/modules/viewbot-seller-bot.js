const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { runNetworkBotCheck } = require('../services/network-bot-detector.js');
const { getRule } = require('../misc/network-bot-rules.js');

// CatQuery-Muster "vb" aus sb-v2 - Schwellen und Begruendungen in utils/network-bot-rules.ts
const RULE = getRule('vb');

module.exports = defineChatModule({
	name: 'viewbot-seller-bot',
	description: 'Bans accounts whose first message with a viewbot domain appears in 3+ (new accounts: 2+) channels within 10 minutes.',
	scope: 'global',
	handlers: {
		message: async (context) => await runNetworkBotCheck(context, RULE),
	},
});
