const { defineChatModule } = require('../chat-modules.js');
const { runNetworkBotCheck } = require('../../../util/network-bot-detector.js');
const { getRule } = require('../../../util/network-bot-rules.js');

// CatQuery-Muster "fm" aus sb-v2 - Schwellen und Begruendungen in utils/network-bot-rules.ts
const RULE = getRule('fm');

module.exports = defineChatModule({
	name: 'first-message-bot',
	description: 'Bans accounts whose first message appears word for word in 10+ (new accounts: 8+) channels within 10 minutes (bot network pattern, CatQuery thresholds).',
	scope: 'global',
	handlers: {
		message: async (context) => await runNetworkBotCheck(context, RULE),
	},
});
