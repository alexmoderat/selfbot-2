const { got } = require('../../../token/got.js');
const { defineChatModule } = require('../chat-modules.js');
const phrases = require('../../../util/moderation-phrases.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../misc/ban-reason.js');
const { deobfuscate, isTrustedSender, rolesFromBadges } = require('../../../misc/text-analysis.js');

/**
 * Uebersetzt Nachrichten in nicht-lateinischer Schrift ins Englische und prueft sie gegen die bestehenden Banphrases,
 * aus sb-v2 (Vorfall #ytposidonyt, 22.08.2026: "Соси" matchte keine Banphrase). Keine eigene Wortliste: alle
 * hinterlegten Beleidigungen greifen so in jeder Sprache. Standardmaessig AUS (Fehluebersetzungen), pro Channel per
 * !langmod on. MyMemory statt Google: die inoffizielle Google-Endpoint blockte die Server-IP mit 429 (22.08.2026).
 */
const NON_LATIN = /[Ѐ-ӿԀ-ԯ؀-ۿݐ-ݿ一-鿿぀-ヿ가-힯֐-׿฀-๿Ͱ-Ͽ]/g;
const MIN_NON_LATIN_CHARS = 2;

const countNonLatin = (text) => text.match(NON_LATIN)?.length ?? 0;

const translateToEnglish = async (text) => {
	const response = await got('Global')({
		url: 'https://api.mymemory.translated.net/get',
		searchParams: { q: text, langpair: 'autodetect|en' },
		timeout: { request: 5000 },
	}).catch((e) => {
		console.warn('[language-moderation] Uebersetzung fehlgeschlagen', e);
		return null;
	});

	return response?.body.responseData?.translatedText?.trim() || null;
};

module.exports = defineChatModule({
	name: 'language-moderation',
	description: 'Translates messages in non-Latin scripts and checks them against ban phrases (opt-in, langmod on).',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, data, platform } = context;
			const userId = user.twitchId;
			if (!userId || userId === platform.selfId || channel.mode !== 'Moderator') {
				return;
			} else if ((await bot.Channels.getData(channel, 'languageModeration')) !== true) {
				return;
			}

			const roles = rolesFromBadges(user.name, data.badges);
			if (isTrustedSender(roles) || countNonLatin(message) < MIN_NON_LATIN_CHARS) {
				return;
			}

			const translated = await translateToEnglish(message);
			if (!translated) {
				return;
			}

			// Wie bisher nur VIP-Immunitaet, keine Sub-Immunitaet
			const matched = phrases.findMatch(channel.id, deobfuscate(translated.toLowerCase()), { isVip: roles.isVip });
			if (!matched) {
				return;
			}

			const label = `${matched.Reason || matched.Phrase} (translated)`;
			console.warn(`[language-moderation] ${user.name} in #${channel.name}: "${message}" -> "${translated}"`);
			await autoBan(targetFromChannel(channel, userId, user.name), {
				reason: formatAutoBanReason(label, platform.selfName),
				publicReason: label,
				duration: matched.Duration,
				status: 'TRANSLATED',
			});
		},
	},
});

Object.assign(module.exports, { countNonLatin });
