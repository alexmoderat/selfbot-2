const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { autoBan, targetFromChannel } = require('../services/moderation.js');
const { isSuppressed, suppressChannel } = require('../services/raid-suppression.js');
const { formatAutoBanReason } = require('../misc/ban-reason.js');
const { rolesFromBadges } = require('../misc/text-analysis.js');

/**
 * Koordinierte Spam-Angriffe, aus sb-v2: mehrere frische Accounts posten binnen kurzer Zeit denselben Text als
 * ihre erste Nachricht. Zahlenfolgen werden vor dem Vergleich zu "#" (alexmoderat, 22.09.2026, Bot-Raid in
 * #zockerinjulia: gleiches Symbol-Template, nur die Ziffern wechselten). Eingehender Raid -> 30 s Pause.
 */
const WINDOW = 10_000;
const USER_THRESHOLD = 4;
const MIN_TEXT_LENGTH = 6;
const PUBLIC_REASON = 'Coordinated spam attack detected';

const recent = new Map();

const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#');

module.exports = defineChatModule({
	name: 'duplicate-spam',
	description: `Bans everyone involved when ${USER_THRESHOLD}+ different users post the same first message within ${WINDOW / 1000}s.`,
	scope: 'global',
	handlers: {
		usernotice: (context) => {
			if (context.msgId === 'raid') {
				suppressChannel(context.channel.id);
			}
		},
		message: async (context) => {
			const { channel, user, message, data, platform } = context;
			const userId = user.twitchId;
			if (!userId || userId === platform.selfId || channel.mode !== 'Moderator' || isSuppressed(channel.id)) {
				return;
			}

			const norm = normalize(message);
			const roles = rolesFromBadges(user.name, data.badges);
			if (norm.length < MIN_TEXT_LENGTH || roles.isMod || roles.isBroadcaster || !data.isFirstMessage) {
				return;
			}

			const now = Date.now();
			let channelMap = recent.get(channel.id);
			if (!channelMap) {
				channelMap = new Map();
				recent.set(channel.id, channelMap);
			}

			const entries = (channelMap.get(norm) ?? []).filter((i) => now - i.ts < WINDOW && i.userId !== userId);
			entries.push({ userName: user.name, userId, ts: now });
			channelMap.set(norm, entries);
			if (entries.length < USER_THRESHOLD) {
				return;
			}

			channelMap.delete(norm); // verhindert doppeltes Ausloesen im gleichen Fenster
			console.warn(`[duplicate-spam] Spam-Muster in #${channel.name}: "${message}" von ${entries.length} Usern`);

			const reason = formatAutoBanReason(PUBLIC_REASON, platform.selfName);
			for (const entry of entries) {
				await autoBan(targetFromChannel(channel, entry.userId, entry.userName), {
					reason,
					publicReason: PUBLIC_REASON,
					status: 'SPAM_PATTERN',
				}).catch(() => false);
			}
		},
	},
});

Object.assign(module.exports, { normalize });
