const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { parseTopic } = require('../services/pubsub.js');
const { sendToDiscord } = require('../services/moderation.js');

const MAX_LENGTH = 1800;

/**
 * Spiegelt rohe Hermes-Nachrichten in den Discord-Mod-Log (aus sb-v2), Format wie gehabt:
 * **[topic-prefix]** `channel` + JSON im Codeblock. Ohne DISCORD_MODLOG_WEBHOOK passiert nichts.
 */
module.exports = defineChatModule({
	name: 'discord-mirror',
	description: 'Mirrors raw PubSub messages into the Discord mod log webhook.',
	scope: 'global',
	handlers: {
		raw: (context) => {
			const raw = typeof context.payload === 'string' ? context.payload : JSON.stringify(context.payload);
			// viewcount kam sekuendlich und stand nie im Discord - das bleibt so
			if (context.payload?.type === 'viewcount') {
				return;
			}

			const prefix = parseTopic(context.topic).prefix;
			const name = context.channel?.name ?? context.broadcasterId;
			const short = raw.length > MAX_LENGTH ? `${raw.slice(0, MAX_LENGTH)}…` : raw;
			void sendToDiscord(`**[${prefix}]** \`${name}\`\n\`\`\`json\n${short}\n\`\`\``);
		},
	},
});
