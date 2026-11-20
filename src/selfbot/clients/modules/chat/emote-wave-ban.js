const { defineChatModule } = require('../chat-modules.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../util/ban-reason.js');
const { isTrustedSender, rolesFromBadges } = require('../../../util/text-analysis.js');
const { accountAgeDays } = require('../../../token/twitch-lists.js');
const { getActiveEmoteSetId, getEmotesInSet, getGlobalEmotes } = require('../../../token/seventv.js');
const { isEmoteOnly, isGeneratedName, isShoutoutText, isYoungAccount } = require('../../../util/emote-wave.js');

/**
 * Bannt Accounts der Emote-Spam-Welle in Channels mit dem Schalter emoteWaveBan (alexmoderat, 15.11.2026: kickster1010, von
 * ~30 Tage alten Accounts mit generierten Namen geflutet; Auswahl "nur dort, strenge Kombi"). Nur wenn ALLE drei zutreffen:
 * Nachricht besteht nur aus Emotes (mind. 3) oder ist ein Shoutout-Text ("Please give shoutout"), Konto juenger als 60 Tage, generierter Name. Mods/VIPs/Subs sind ausgenommen.
 */
const PUBLIC_REASON = 'Automated bot detection';
const CACHE_MS = 10 * 60_000;
const cache = new Map(); // channel.id -> { names: Set, at }

const knownEmoteNames = async (channel) => {
	const hit = cache.get(channel.id);
	if (hit && Date.now() - hit.at < CACHE_MS) {
		return hit.names;
	}

	const names = new Set();
	try {
		for (const i of await getEmotesInSet(await getActiveEmoteSetId(channel))) {
			names.add(i.alias);
		}
		for (const i of await getGlobalEmotes()) {
			names.add(i.name);
		}
	} catch (e) {
		console.warn(`[emote-wave-ban] 7TV-Emotes von #${channel.name} nicht ladbar: ${e?.message ?? e}`);
	}
	cache.set(channel.id, { names, at: Date.now() });
	return names;
};

module.exports = defineChatModule({
	name: 'emote-wave-ban',
	description: 'In channels with the emoteWaveBan switch: bans young accounts with generated names that post only emotes or shoutout begging.',
	scope: 'global',
	handlers: {
		message: async (context) => {
			const { channel, user, message, data, platform } = context;
			const userId = user.twitchId;
			if (!userId || userId === platform.selfId || channel.mode !== 'Moderator' || (await bot.Channels.getData(channel, 'emoteWaveBan')) !== true) {
				return;
			}
			// Billigste Pruefungen zuerst: Name und Rolle, dann Emote-Form, zuletzt die Kontoalter-Abfrage
			if (!isGeneratedName(user.name) || isTrustedSender(rolesFromBadges(user.name, data.badges))) {
				return;
			}
			if (!isShoutoutText(message) && !isEmoteOnly(message, context.msg?.tags?.emotes, await knownEmoteNames(channel))) {
				return;
			}
			const age = await accountAgeDays(userId, { byId: true });
			if (!isYoungAccount(age)) {
				return;
			}

			console.warn(`[emote-wave-ban] ${user.name} in #${channel.name} (${Math.round(age.ageDays)} Tage): "${message}"`);
			await autoBan(targetFromChannel(channel, userId, user.name), {
				reason: formatAutoBanReason(PUBLIC_REASON, platform.selfName),
				publicReason: PUBLIC_REASON,
				status: 'EMOTE_WAVE',
			}).catch(() => false);
		},
	},
});
