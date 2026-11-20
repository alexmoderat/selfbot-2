const { defineChatModule } = require('../chat-modules.js');
const { runNetworkBotCheck } = require('../../../util/network-bot-detector.js');
const { getRule } = require('../../../misc/network-bot-rules.js');

// CatQuery-Muster "dc" aus sb-v2 - Schwellen und Begruendungen in utils/network-bot-rules.ts
const RULE = getRule('dc');

module.exports = defineChatModule({
	name: 'discord-scammer-bot',
	description: 'Bans accounts whose Discord-invite first message appears in 3+ (new accounts: 2+) channels within 10 minutes.',
	scope: 'global',
	handlers: {
		message: async (context) => await runNetworkBotCheck(context, RULE),
	},
});
