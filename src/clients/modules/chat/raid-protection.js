const { defineChatModule } = require('../chat-modules.js');
const { autoBan, sayModLog, targetFromChannel } = require('../../../util/moderation.js');
const { isSuppressed, suppressChannel } = require('../../../util/raid-suppression.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { isTrustedSender, rolesFromBadges } = require('../../../util/text-analysis.js');

/**
 * Bannt bei einem ploetzlichen Schub Erstnachrichten, unabhaengig vom Text, aus sb-v2 (alexmoderat, 22.09.2026,
 * Bot-Raid in #zockerinjulia mit mehreren Templates parallel, jedes unter der duplicate-spam-Schwelle).
 * Hoeheres Fehlalarm-Risiko (echter Hype sieht gleich aus), deshalb:
 *  - Twitch-Raid setzt aus (gemeinsam mit duplicate-spam)
 *  - nur je Channel eingeschaltet (Channel_Data raidProtection), Default aus
 *  - permanenter Ban war alexmoderats ausdruecklicher Wunsch
 *  - Probelauf (raidProtectionDryRun, Default an): meldet nur im Modlog, wen es gebannt HAETTE
 */
const WINDOW = 5_000;
const USER_THRESHOLD = 8;
const PUBLIC_REASON = 'Coordinated raid attack detected';

const recent = new Map();

module.exports = defineChatModule({
	name: 'raid-protection',
	description: `Bans on ${USER_THRESHOLD}+ different first messages within ${WINDOW / 1000}s, regardless of text - only where enabled.`,
	scope: 'global',
	handlers: {
		usernotice: (context) => {
			if (context.msgId === 'raid') {
				suppressChannel(context.channel.id);
			}
		},
		message: async (context) => {
			const { channel, user, data, platform } = context;
			const userId = user.twitchId;
			if (!userId || userId === platform.selfId || channel.mode !== 'Moderator' || isSuppressed(channel.id)) {
				return;
			}

			const roles = rolesFromBadges(user.name, data.badges);
			if (roles.isMod || roles.isBroadcaster || isTrustedSender(roles) || !data.isFirstMessage) {
				return;
			} else if ((await bot.Channels.getData(channel, 'raidProtection')) !== true) {
				return;
			}

			const now = Date.now();
			const entries = (recent.get(channel.id) ?? []).filter((i) => now - i.ts < WINDOW);
			if (!entries.some((i) => i.userId === userId)) {
				entries.push({ userId, userName: user.name, ts: now });
			}
			recent.set(channel.id, entries);
			if (entries.length < USER_THRESHOLD) {
				return;
			}

			recent.set(channel.id, []); // verhindert doppeltes Ausloesen im gleichen Fenster
			const names = entries.map((i) => i.userName);

			// Im Zweifel Probelauf, nicht scharf
			if ((await bot.Channels.getData(channel, 'raidProtectionDryRun')) !== false) {
				console.warn(`[raid-protection] PROBELAUF in #${channel.name}: haette ${entries.length} gebannt - ${names.join(', ')}`);
				await sayModLog(`🧪 DRY RUN — would have banned ${entries.length} in #${channel.name}: ${names.map((i) => `@${i}`).join(' ')}`);
				return;
			}

			console.warn(`[raid-protection] Raid-Angriff in #${channel.name}: ${entries.length} Erstnachrichten binnen ${WINDOW / 1000} s`);
			const reason = formatAutoBanReason(PUBLIC_REASON, platform.selfName);
			for (const entry of entries) {
				await autoBan(targetFromChannel(channel, entry.userId, entry.userName), {
					reason,
					publicReason: PUBLIC_REASON,
					status: 'RAID_ATTACK',
					automated: true,
				}).catch(() => false);
			}
		},
	},
});
