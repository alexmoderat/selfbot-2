const { defineChatModule } = require('../clients/modules/chat-modules.js');

/**
 * Wiederholt geteilte Watch-Streaks in #ninou2 mit einem W dahinter (ninou2, 03.11.2026: "repost the same exact
 * share in the chat and maybe add W streak at the end of it"; alexmoderat: nur dort). Der eigene Streak hat watch-streak-progress.
 */
const CHANNEL = 'ninou2';

const repostText = (login, value) => `${login} watched ${value} consecutive streams and sparked a watch streak! W @${login} wW streak`;

module.exports = defineChatModule({
	name: 'watch-streak-repost',
	description: 'Reposts shared watch streaks in #ninou2.',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags, platform } = context;
			if (msgId !== 'viewermilestone' || tags['msg-param-category'] !== 'watch-streak' || channel.name !== CHANNEL) {
				return;
			}

			const login = String(tags.login ?? '').toLowerCase();
			const value = Number.parseInt(String(tags['msg-param-value'] ?? ''), 10);
			if (login && login !== platform.selfName && Number.isFinite(value)) {
				await bot.Channels.send(channel, repostText(login, value));
			}
		},
	},
});

Object.assign(module.exports, { repostText });
