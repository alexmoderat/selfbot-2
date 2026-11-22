const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { rolesFromBadges } = require('../../../util/text-analysis.js');
const { accountAgeDays } = require('../../../token/twitch-lists.js');

/**
 * Bannt frische Accounts bei ihrer ersten Nachricht, unabhaengig von AutoMod, aus sb-v2 (nach dem Perma-Ban eines
 * Dauerstoerers am 28.07.2026 war eine Serie Wegwerfaccounts absehbar). Nur wo eingeschaltet (Channel_Data
 * newAccountGuard): die Regel trifft zwangslaeufig auch Leute, die schlicht neu bei Twitch sind.
 * Nur bei der ERSTEN Nachricht, sonst ginge pro Nachricht eine Helix-Abfrage raus.
 */
const MIN_AGE_DAYS = 7;
const PUBLIC_REASON = `Account younger than ${MIN_AGE_DAYS} days`;

module.exports = defineChatModule({
	name: 'new-account-guard',
	description: 'Bans fresh accounts on their first message - only in channels that enabled it.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, data, platform } = context;
			const userId = user.twitchId;
			// Erst die billigen Ausschluesse, dann die Einstellung, dann Twitch
			if (!data.isFirstMessage || !userId || userId === platform.selfId || channel.mode !== 'Moderator') {
				return;
			}

			const roles = rolesFromBadges(user.name, data.badges);
			if (roles.isBroadcaster || roles.isMod || roles.isVip || roles.isSubscriber) {
				return;
			} else if ((await bot.Channels.getData(channel, 'newAccountGuard')) !== true) {
				return;
			}

			const age = await accountAgeDays(userId, { byId: true });
			if (!age || age.ageDays >= MIN_AGE_DAYS) {
				return;
			}

			Logger.warn(`[new-account-guard] Frischer Account (${age.ageDays.toFixed(1)} d) bei erster Nachricht: ${user.name} in #${channel.name}`);
			await autoBan(targetFromChannel(channel, userId, user.name), {
				reason: formatAutoBanReason(PUBLIC_REASON, platform.selfName),
				publicReason: PUBLIC_REASON,
				status: 'AUTOMOD_NEWACCOUNT_FIRSTMSG',
				automated: true,
			});
		},
	},
});
