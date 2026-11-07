const { defineChatModule } = require('../clients/modules/chat-modules.js');

/** Gratuliert dem eigenen Konto zum Mod-Jubilaeum (modiversary, ueber den CatQuery-Firehose), aus sb-v2 */
const formatMonths = (months) => {
	const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
	if (months % 12 === 0) {
		return plural(months / 12, 'year');
	} else if (months > 12) {
		return `${plural(Math.floor(months / 12), 'year')} and ${plural(months % 12, 'month')}`;
	}

	return plural(months, 'month');
};

module.exports = defineChatModule({
	name: 'mod-anniversary',
	description: "Congratulates the bot's own account on mod anniversaries.",
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags, platform } = context;
			const login = String(tags.login ?? '').toLowerCase();
			if (msgId !== 'modiversary' || login !== platform.selfName) {
				return;
			}

			const months = Number.parseInt(String(tags['msg-param-months'] ?? ''), 10) || 0;
			const displayName = String(tags['display-name'] || login);
			await bot.Channels.send(channel, `🎉 @${displayName} Congrats on ${formatMonths(months)} as a mod! PogChamp`);
		},
	},
});

Object.assign(module.exports, { formatMonths });
