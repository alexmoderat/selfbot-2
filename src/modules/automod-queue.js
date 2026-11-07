const { got } = require('../token/got.js');
const { defineChatModule } = require('../clients/modules/chat-modules.js');
const phrases = require('../services/moderation-phrases.js');
const { autoBan, targetFromChannel } = require('../services/moderation.js');
const { formatAutoBanReason, formatBanphraseReason, localizeViewbotReason } = require('../misc/ban-reason.js');
const { deobfuscate, getLinkSpamReason } = require('../misc/text-analysis.js');
const { accountAgeDays } = require('../misc/twitch-lists.js');

/**
 * Nachrichten, die Twitchs AutoMod zurueckhaelt (PubSub automod-queue), aus sb-v2. Diese Nachrichten laufen NICHT
 * durch banphrase-filter, deshalb hier dieselbe Reason-Logik (localizeViewbotReason). Pruefreihenfolge:
 *   1. Banphrase (global -> Channel -> Preset)
 *   2. Link-Spam
 *   3. Verdaechtige @mention-Token (>= 2 gemischte Schreibweise, VIP/Sub ausgenommen)
 *   4. Account juenger als 7 Tage (Schalter "autoban agecheck")
 * Bei jedem Treffer wird die Nachricht in der Queue abgelehnt (DENY) und der User gebannt.
 */
const ACCOUNT_MIN_AGE_DAYS = 7;

const findMentionTokens = (text) => text.match(/@[A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*/g) ?? [];

const denyMessage = async (messageId, selfId) => {
	const response = await got('Helix')({
		method: 'POST',
		url: 'moderation/automod/message',
		json: { user_id: selfId, msg_id: messageId, action: 'DENY' },
		responseType: 'text',
	}).catch(() => null);

	if (!response?.ok) {
		console.warn(`[automod-queue] Deny fehlgeschlagen (${response?.statusCode ?? '?'})`);
	}
};

module.exports = defineChatModule({
	name: 'automod-queue',
	description: 'Checks messages held by AutoMod and bans on hits.',
	scope: 'global',
	handlers: {
		automodQueue: async (context) => {
			const { channel, platform } = context;
			const payload = context.payload;
			const data = payload?.data;
			if (!channel || !data) {
				return;
			}

			const message = data.message ?? {};
			const text = message.content?.text;
			const userId = message.sender?.user_id ?? null;
			const login = message.sender?.login ?? String(userId ?? '?');
			const messageId = data.id ?? message.id ?? null;
			const status = data.status ?? '';

			// Nur zurueckgehaltene Nachrichten pruefen; genehmigte/abgelehnte nur loggen
			if (payload.type !== 'automod_caught_message' || status !== 'PENDING') {
				if (status === 'ALLOWED' || status === 'DENIED') {
					console.log(
						`[automod-queue] ${status}: "${text ?? '?'}" von ${login} in #${channel.name}${data.resolver_login ? ` - by ${data.resolver_login}` : ''}`,
					);
				}
				return;
			} else if (!text || !userId || !messageId) {
				console.warn('[automod-queue] Nachricht ohne Text/User/ID - uebersprungen');
				return;
			}

			console.warn(`[automod-queue] Held: "${text}" von ${login} in #${channel.name} (${data.reason_code ?? '?'})`);
			const target = targetFromChannel(channel, userId, login);
			const punish = async (reason, publicReason, statusTag, duration = null) => {
				void denyMessage(messageId, platform.selfId);
				await autoBan(target, { reason, publicReason, duration, status: statusTag, automated: true });
			};

			// 1. Banphrase
			// Wie banphrase-filter normalisiert - vorher nur kleingeschrieben, verschleierte Schrift lief durch (26.10.2026)
			const matched = phrases.findMatch(channel.id, deobfuscate(text).toLowerCase());
			if (matched) {
				phrases.recordHit(matched, channel.id);
				const label = localizeViewbotReason(channel.name, matched.Reason || matched.Phrase);
				await punish(formatBanphraseReason(label, platform.selfName), label, 'AUTOMOD', matched.Duration);
				return;
			}

			// 2. Link-Spam
			if (getLinkSpamReason(text)) {
				const label = localizeViewbotReason(channel.name, 'Viewbot Services');
				await punish(formatBanphraseReason(label, platform.selfName), label, 'AUTOMOD');
				return;
			}

			// 3. Verdaechtige @mention-Token
			const isVipOrSub = (message.sender?.badges ?? []).some((i) => ['vip', 'subscriber', 'founder'].includes(i.id));
			if (!isVipOrSub && findMentionTokens(text).length >= 2) {
				const label = 'Suspicious tracking token in message';
				await punish(formatAutoBanReason(label, platform.selfName), label, 'AUTOMOD_TOKEN');
				return;
			}

			// 4. Frischer Account
			if ((await bot.Channels.getData(channel, 'autobanAgecheckDisabled')) === true) {
				console.log(`[automod-queue] Alterscheck in #${channel.name} deaktiviert - ${login} durchgelassen`);
				return;
			}

			const age = await accountAgeDays(userId, { byId: true });
			if (age && age.ageDays < ACCOUNT_MIN_AGE_DAYS) {
				const label = `Account younger than ${ACCOUNT_MIN_AGE_DAYS} days`;
				await punish(formatAutoBanReason(label, platform.selfName), label, 'AUTOMOD_NEWACCOUNT');
				return;
			}

			console.log('[automod-queue] Keine Regel getroffen, Nachricht bleibt in der Queue');
		},
	},
});

Object.assign(module.exports, { findMentionTokens });
