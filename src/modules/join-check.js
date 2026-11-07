const { defineChatModule } = require('../clients/modules/chat-modules.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { autoBan, targetFromChannel } = require('../services/moderation.js');
const { formatAutoBanReason } = require('../misc/ban-reason.js');
const { gqlPublic } = require('../misc/twitch-gql.js');
const { getUniqueDomains, isAllowlistedDomain } = require('../misc/text-analysis.js');

/**
 * Prueft betretende User auf Werbe-Accounts (Bio + angepinnte Nachricht) und bannt sie, aus sb-v2.
 * Eine Schlange, beide Pruefungen, ein Ban. Schalter "autoban promo" (Channel_Data autobanPromoDisabled).
 *
 * STANDARDMAESSIG AUS (config: chat-modules.blacklist) - wie in sb-v2 (V2_JOIN_CHECK=1): im Ban-Log standen ueber die
 * ganze Historie drei echte Bans, dagegen in drei Stunden nach einer Reparatur 19 Treffer, 23 gescheiterte Versuche,
 * ein echter Ban (u. a. streamstickers, eine Extension mit 1,3 Mio. Nutzern, und ein Zuschauer mit Pin auf
 * twitch.tv/subs/...). Vor dem Anschalten: Fehlversuche merken (400 "may not be banned"), Pin-Pruefung um ein
 * Werbewort erweitern, Bio-Keywords aus der Viewbot-Zeit ueberarbeiten.
 */
const BIO_CACHE_TTL = 24 * 60 * 60 * 1000;
const QUEUE_DELAY = 350;
const MAX_SEEN = 50_000;

// Pin-Text wirbt fuer einen anderen Channel
const PROMO_PATTERN = /twitch\.tv\/[a-zA-Z0-9_]{3,}/i;
// Bewusst ohne "follow me" (steht in Bios oft harmlos) - der Unterschied bestand schon im alten Code
const BIO_PROMO_KEYWORDS = ['top viewers', 'best viewers', 'cheap viewers', 'buy viewers', 'viewers', 'seller', 'promo', 'advert', 'ad service'];

const bioCache = new Map();
const seen = new Set();
const queue = new Map();
let running = false;

const isBioSuspicious = (bio) => {
	if (!bio) {
		return false;
	}

	const lower = bio.toLowerCase();
	const suspicious = getUniqueDomains(lower).filter((i) => !isAllowlistedDomain(i));
	return suspicious.length > 0 && BIO_PROMO_KEYWORDS.some((i) => lower.includes(i));
};

const fetchPinnedText = async (userId) => {
	const data = await gqlPublic(`{ channel(id: ${JSON.stringify(userId)}) {
		pinnedChatMessages(first: 1) { edges { node { pinnedMessage { content { text } } } } }
	} }`).catch(() => null);

	return data?.channel?.pinnedChatMessages?.edges[0]?.node?.pinnedMessage?.content?.text ?? null;
};

const ban = async (channel, userId, login, reason, publicReason, status) => {
	if ((await bot.Channels.getData(channel, 'autobanPromoDisabled')) === true) {
		console.log(`[join-check] Promo-Ban in #${channel.name} aus - ${login} uebersprungen`);
		return false;
	}

	return await autoBan(targetFromChannel(channel, userId, login), { reason, publicReason, status }).catch(() => false);
};

const check = async (login, channels, selfName) => {
	// Bio (Helix), 24 h zwischengespeichert
	let bio = bioCache.get(login) ?? null;
	if (!bio || Date.now() - bio.ts >= BIO_CACHE_TTL) {
		const user = await fetchTwitchUser(login).catch(() => null);
		bio = user ? { ts: Date.now(), suspicious: isBioSuspicious(user.description), userId: user.id } : null;
		if (bio) {
			bioCache.set(login, bio);
			if (bio.suspicious) {
				console.warn(`[join-check] Bio-Spam: ${login} - "${user?.description.slice(0, 100)}"`);
			}
		}
	}

	const bannedIn = new Set();
	if (bio?.suspicious) {
		for (const channel of channels) {
			const reason = 'Promotional bot account (automated by alexmoderat)';
			if (await ban(channel, bio.userId, login, reason, 'Promotional bot account', 'BIO SPAM')) {
				bannedIn.add(channel.id);
			}
		}
	}

	// Angepinnte Nachricht (GQL), einmal je Laufzeit
	if (seen.has(login) || !bio) {
		return;
	}
	seen.add(login);
	if (seen.size > MAX_SEEN) {
		seen.clear();
	}

	const pinned = await fetchPinnedText(bio.userId);
	if (!pinned || !PROMO_PATTERN.test(pinned)) {
		return;
	}

	console.warn(`[join-check] Promo-Pin bei ${login}: "${pinned}"`);
	for (const channel of channels) {
		if (!bannedIn.has(channel.id)) {
			await ban(channel, bio.userId, login, formatAutoBanReason('Promo Account', selfName), 'Promo Account', 'PROMO PIN');
		}
	}
};

const drain = async (selfName) => {
	if (running) {
		return;
	}

	running = true;
	try {
		while (queue.size > 0) {
			const [login, channels] = queue.entries().next().value;
			queue.delete(login);
			await check(login, channels, selfName).catch((e) => console.warn(`[join-check] ${login}`, e));
			await new Promise((resolve) => setTimeout(resolve, QUEUE_DELAY));
		}
	} finally {
		running = false;
	}
};

module.exports = defineChatModule({
	name: 'join-check',
	description: 'Bans joining promo accounts by bio and pinned message (disabled by default).',
	scope: 'global',
	handlers: {
		userJoin: (context) => {
			const { channel, userName } = context;
			if (channel.mode !== 'Moderator') {
				return;
			}

			// Bekannt unauffaellig und schon auf Pin geprueft -> gar nicht erst einreihen
			const cached = bioCache.get(userName);
			if (seen.has(userName) && cached && Date.now() - cached.ts < BIO_CACHE_TTL && !cached.suspicious) {
				return;
			}

			const channels = queue.get(userName) ?? new Set();
			channels.add(channel);
			queue.set(userName, channels);
			void drain(bot.Twitch.selfName);
		},
	},
});

Object.assign(module.exports, { isBioSuspicious });
