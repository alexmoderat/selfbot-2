const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');

/**
 * Automatischer zweiteiliger Shoutout beim Reinraiden, aus sb-v2 (ninou2, 12./13.08.2026): sofort "just raided",
 * nach 5-10 s der Dank mit Link. Opt-in je Channel ueber raidshoutout on (Default aus seit 22.08.2026).
 */
const DELAY_MIN_MS = 5000;
const DELAY_MAX_MS = 10_000;

// Emote-Zeilen nur fuer ninou2 (ausdruecklicher Wunsch, 13.08.2026), kein globales Feature
const raidIntro = (channel, displayName, viewerCount) =>
	(viewerCount ? `@${displayName} just raided the channel with ${viewerCount} raiders!` : `@${displayName} just raided the channel!`) +
	(channel === 'ninou2' ? ' PagMan PagFlag PagRace pagm widePagMan PagBounce' : '');

// Leerzeichen vor dem Komma, sonst erkennen BTTV/7TV/FFZ "peepoLove," nicht (ninou2, 13.08.2026)
const raidThanks = (channel, displayName, login) =>
	`Thank you very much for the raid @${displayName}${channel === 'ninou2' ? ' berryKiss peepoLove' : ''} , make sure to check them out at: twitch.tv/${login}`;

module.exports = defineChatModule({
	name: 'raid-shoutout',
	description: 'Posts a two-part shoutout when the channel gets raided (opt-in via raidshoutout).',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags } = context;
			if (msgId !== 'raid' || (await bot.Channels.getData(channel, 'raidShoutout')) !== true) {
				return;
			}

			const login = String(tags['msg-param-login'] ?? '');
			if (!login) {
				return;
			}

			const displayName = String(tags['msg-param-displayName'] ?? '') || login;
			const viewerCount = String(tags['msg-param-viewerCount'] ?? '') || undefined;
			await bot.Channels.send(channel, raidIntro(channel.name, displayName, viewerCount));

			setTimeout(
				() => {
					void bot.Channels.send(channel, raidThanks(channel.name, displayName, login))
						.then(() => Logger.info(`[raid-shoutout] Shoutout fuer ${login} in #${channel.name}`))
						.catch((e) => Logger.warn(`[raid-shoutout] #${channel.name}`, e));
				},
				DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS),
			);
		},
	},
});

Object.assign(module.exports, { raidIntro, raidThanks });
