const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { isTrustedSender, rolesFromBadges } = require('../../../util/text-analysis.js');

/**
 * ASCII-Art-Spam (Block-/Box-Drawing-/Braille-Zeichen als "Bild"), aus sb-v2. alexmoderat, 18.09.2026: "Kannst du im
 * bot einbauen das er ascii zeug moderiert?" - Anlass ein Braille-Art-Wall, AutoMod war aus. Diese Unicode-Bereiche
 * kommen in Woertern, Emotes oder Emoji nicht vor, ein Zeichen-Anteil reicht ohne Wortliste.
 */
const ART_CHAR = /[─-╿▀-▟■-◿\u2800-⣿\u{1FB00}-\u{1FBFF}]/gu;
const MIN_ART_CHARS = 12;
const MIN_ART_RATIO = 0.25;
const TIMEOUT = 600;

const isAsciiArtSpam = (message) => {
	const matches = message.match(ART_CHAR);
	if (!matches || matches.length < MIN_ART_CHARS) {
		return false;
	}

	return matches.length / message.length >= MIN_ART_RATIO;
};

module.exports = defineChatModule({
	name: 'ascii-art-filter',
	description: "Times out Braille/block/box-drawing ASCII art spam - only in the bot's own channel.",
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, data, platform } = context;
			// alexmoderat, 18.09.2026: "wollte das eigentlich nur für meinen channel"
			if (channel.name !== platform.selfName.toLowerCase() || !user.twitchId || user.twitchId === platform.selfId) {
				return;
			} else if (isTrustedSender(rolesFromBadges(user.name, data.badges)) || !isAsciiArtSpam(message)) {
				return;
			}

			const reason = formatAutoBanReason('ASCII art spam', platform.selfName);
			Logger.warn(`[ascii-art-filter] ${user.name} in #${channel.name}`);
			await autoBan(targetFromChannel(channel, user.twitchId, user.name), {
				reason,
				publicReason: reason,
				duration: TIMEOUT,
				status: 'ASCII_ART',
			});
		},
	},
});

Object.assign(module.exports, { isAsciiArtSpam });
