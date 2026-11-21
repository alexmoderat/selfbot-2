const { Logger } = require('../../../misc/logger.js');
const { defineChatModule } = require('../chat-modules.js');
const { autoBan, getModLogChannel, sayModLog, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { getMonitoredStatus } = require('../../../token/catquery-api.js');
const { createBanLimiter, monitoredBanLabel, shouldBanMonitored } = require('../../../util/monitored-ban.js');
const { createNotifier } = require('../../../util/monitored-notice.js');
const { isTrustedSender, rolesFromBadges } = require('../../../util/text-analysis.js');

/**
 * Erstnachricht eines bei CatQuery ueberwachten Accounts, aus sb-v2:
 *  - Ban, wenn der Grund dafuer taugt (nicht "Self-Promo", ausser in alexmoderat/alex_sbottats, siehe monitored-ban.ts)
 *  - sonst (oder wenn der Ban nicht ausgefuehrt wird, z. B. "autoban all disable") ein Hinweis im Mod-Log
 * Nur Erstnachrichten nicht vertrauenswuerdiger Sender, damit die Anfragen an CatQuery wenige bleiben.
 * Hoechstens 10 Bans pro Minute. Ban ausschalten: MONITORED_BAN=0 (Hinweise bleiben).
 */
const notifier = createNotifier({ lookup: getMonitoredStatus, say: sayModLog });
const limiter = createBanLimiter(10, 60_000);

module.exports = defineChatModule({
	name: 'monitored-user-notice',
	description: 'Bans accounts monitored by CatQuery on their first message (self-promo only in own channels), otherwise a mod-log notice.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, data, platform } = context;
			const userId = user.twitchId;
			if (!data.isFirstMessage || !userId || userId === platform.selfId || channel.name === getModLogChannel()) {
				return;
			} else if (isTrustedSender(rolesFromBadges(user.name, data.badges))) {
				return;
			}

			const status = await notifier.lookup(user.name);
			if (!status?.monitored) {
				return;
			}

			const canBan = process.env.MONITORED_BAN !== '0' && channel.mode === 'Moderator';
			if (canBan && shouldBanMonitored(status, channel.name) && limiter.tryTake()) {
				const label = monitoredBanLabel(status.reason);
				const ok = await autoBan(targetFromChannel(channel, userId, user.name), {
					reason: formatAutoBanReason(label, platform.selfName),
					publicReason: label,
					status: 'CATQUERY_MONITORED',
					automated: true,
				});

				if (ok) {
					Logger.warn(`[monitored-user-notice] Ban ${user.name} in #${channel.name} - CatQuery: ${status.reason ?? '?'}`);
					return;
				}
			}

			await notifier.notify(user.name, status, channel.name, message);
		},
	},
});
