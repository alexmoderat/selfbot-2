const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { parseTopic } = require('../services/pubsub.js');
const { push } = require('../services/event-feed.js');

/** Rohe Hermes-Events in einen Ringpuffer fuer die Statusseite (aus sb-v2) */
module.exports = defineChatModule({
	name: 'event-feed-capture',
	description: 'Collects raw PubSub events for the status page.',
	scope: 'global',
	handlers: {
		raw: (context) => {
			// viewcount kommt sekuendlich und wuerde den Puffer sofort fluten
			if (context.payload?.type === 'viewcount') {
				return;
			}

			push({
				ts: Date.now(),
				prefix: parseTopic(context.topic).prefix,
				channel: context.channel?.name ?? context.broadcasterId,
				payload: context.payload,
			});
		},
	},
});
