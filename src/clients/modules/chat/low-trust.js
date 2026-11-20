const { defineChatModule } = require('../chat-modules.js');
const phrases = require('../../../util/moderation-phrases.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { applyTreatment, isBanEvader, isSuspicious, markEvader } = require('../../../util/low-trust-state.js');
const { formatBanphraseReason, localizeViewbotReason } = require('../../../misc/ban-reason.js');
const { PROMO_PHRASE_PATTERNS, deobfuscateLoose, getFollowFarmReason, getSuspiciousLinkReason } = require('../../../misc/text-analysis.js');

/**
 * Nachrichten von Usern, die Twitch als verdaechtig markiert hat (PubSub low-trust-users), aus sb-v2:
 *   low_trust_user_treatment_update  Status aendert sich -> nur Zustand pflegen (low-trust-state.ts)
 *   low_trust_user_new_message       Nachricht pruefen -> Banphrase, Follow-Farm, Link-Spam (strenger als im Chat)
 * Schalter "autoban spam" (Channel_Data autobanSpamDisabled).
 */

const normalizePhrase = (raw) =>
	String(raw ?? '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();

/** Auffaellige Domains und Promo-Formulierungen ins sellerbot-Preset lernen */
const promoVariants = (messageText, domains) => {
	const learned = new Set();
	for (const domain of domains) {
		const phrase = normalizePhrase(domain);
		if (phrase.length >= 4) {
			learned.add(phrase);
		}
	}
	for (const pattern of PROMO_PHRASE_PATTERNS) {
		const phrase = normalizePhrase(messageText.match(pattern)?.[0]);
		if (phrase.length >= 4) {
			learned.add(phrase);
		}
	}

	return [...learned];
};

module.exports = defineChatModule({
	name: 'low-trust',
	description: 'Checks messages of flagged users more strictly and keeps their status.',
	scope: 'global',
	handlers: {
		lowTrust: async (context) => {
			const { channel, platform } = context;
			const payload = context.payload;
			const data = payload?.data;
			if (!channel || !data) {
				return;
			}

			const ltu = data.low_trust_user ?? {};
			const userId = ltu.sender?.user_id ?? data.target_user_id ?? ltu.id ?? ltu.user_id ?? null;
			const login = (ltu.sender?.login ?? data.target_user ?? ltu.login ?? ltu.user_login ?? '?').toLowerCase();
			const status = ltu.treatment ?? data.treatment ?? ltu.low_trust_status ?? '?';

			// Statusaenderung
			if (payload.type === 'low_trust_user_treatment_update') {
				const updatedBy = ltu.updated_by?.login ?? data.updated_by?.login;
				console.log(`[low-trust] Status-Update: ${login} in #${channel.name} -> ${status}${updatedBy ? ` (by ${updatedBy})` : ''}`);
				if (userId) {
					applyTreatment(userId, status);
				}
				return;
			} else if (payload.type !== 'low_trust_user_new_message') {
				console.log(`[low-trust] Unbekannter Typ in #${channel.name}: ${payload.type ?? '?'}`);
				return;
			}

			// Nachricht eines markierten Users
			const messageText = data.message_content?.text ?? data.message?.content?.text ?? data.message?.text ?? '';
			const banEvaluation = ltu.ban_evasion_evaluation ?? 'UNKNOWN';
			if (banEvaluation === 'LIKELY_EVADER' && userId) {
				markEvader(userId);
				console.warn(`[low-trust] LIKELY_EVADER erkannt: ${login}`);
			}

			console.warn(`[low-trust] Nachricht: ${login} in #${channel.name} (${status}, eval:${banEvaluation}): "${messageText}"`);
			if (!userId || channel.mode !== 'Moderator') {
				return;
			} else if ((await bot.Channels.getData(channel, 'autobanSpamDisabled')) === true) {
				console.log(`[low-trust] Spam-Autoban in #${channel.name} deaktiviert - skip ${login}`);
				return;
			} else if (!messageText) {
				console.warn(`[low-trust] Leerer Text von ${login} - Phrasen-Check uebersprungen`);
				return;
			}

			const target = targetFromChannel(channel, userId, login);
			const evader = isBanEvader(userId);
			const suspicious = isSuspicious(userId);

			// 1. Banphrase - NFKC zusaetzlich zur Deobfuskierung, so war es im alten Handler
			const lower = deobfuscateLoose(messageText.normalize('NFKC').toLowerCase());
			const matched = phrases.findMatch(channel.id, lower);
			if (matched) {
				phrases.recordHit(matched, channel.id);
				const label = localizeViewbotReason(channel.name, matched.Reason || matched.Phrase);
				await autoBan(target, {
					reason: formatBanphraseReason(label, platform.selfName),
					publicReason: label,
					duration: matched.Duration,
					status: evader ? 'BAN EVADER' : suspicious ? 'SUSPICIOUS' : 'SUSPICIOUS MSG',
					automated: true,
				});
				return;
			}

			// 1b. Follow-Farm / Discord-Rekrutierung ohne Link
			const followFarm = getFollowFarmReason(messageText);
			if (followFarm) {
				await autoBan(target, {
					reason: formatBanphraseReason(followFarm.reason, platform.selfName),
					publicReason: followFarm.reason,
					status: evader ? 'BAN EVADER FOLLOW-FARM' : 'FOLLOW-FARM',
					automated: true,
				});
				return;
			}

			// 2. Link-Spam (strengere Regeln als im normalen Chat)
			const linkSpam = getSuspiciousLinkReason(messageText, status);
			if (!linkSpam) {
				return;
			}

			console.warn(`[low-trust] Link-Spam von ${login} in #${channel.name}: ${linkSpam.domains.join(', ')}`);
			const preset = phrases.getPreset('sellerbot');
			if (preset) {
				const learned = promoVariants(messageText, linkSpam.domains);
				for (const phrase of learned) {
					await phrases
						.addPhrase(
							{ preset: preset.ID },
							{
								phrase,
								reason: `Auto-learned promo (suspicious:${channel.name})`,
								addedBy: platform.selfName,
							},
						)
						.catch(() => {});
				}
				if (learned.length > 0) {
					console.log(`[low-trust] ${learned.length} Promo-Banphrase(n) gelernt: ${learned.join(', ')}`);
				}
			}

			const label = localizeViewbotReason(channel.name, 'Viewbot Services');
			await autoBan(target, {
				reason: formatBanphraseReason(label, platform.selfName),
				publicReason: label,
				status: evader ? 'BAN EVADER LINKSPAM' : 'SUSPICIOUS LINKSPAM',
			});
		},
	},
});

Object.assign(module.exports, { promoVariants });
