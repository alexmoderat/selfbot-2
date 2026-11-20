const { defineChatModule } = require('../chat-modules.js');

/**
 * Sagt in #ninou2 an, wie viele Streams dem Bot-Konto bis zum Watch-Streak-Ziel fehlen, aus sb-v2. Ziel nach den 100
 * jetzt 250, ohne Belohnung (ninou2, 05.11.2026: "i just want you to have a goal/objective so you keep your streak going").
 */
const GOAL = 250;
const CHANNEL = 'ninou2';

const progressText = (value) => {
	const remaining = GOAL - value;
	return remaining > 0 ? `${value}/${GOAL} watch streak — ${remaining} more to go!` : `${value}/${GOAL} watch streak — goal reached! 🎉`;
};

module.exports = defineChatModule({
	name: 'watch-streak-progress',
	description: 'Announces how many streams are left until the 250 watch streak.',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags, platform } = context;
			if (msgId !== 'viewermilestone' || tags['msg-param-category'] !== 'watch-streak' || channel.name !== CHANNEL) {
				return;
			} else if (String(tags.login ?? '').toLowerCase() !== platform.selfName) {
				return;
			}

			const value = Number.parseInt(String(tags['msg-param-value'] ?? ''), 10) || 0;
			await bot.Channels.send(channel, progressText(value));
		},
	},
});

Object.assign(module.exports, { progressText });
