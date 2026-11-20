const { defineChatModule } = require('../chat-modules.js');

const { fetchTwitchUser } = require('../../../util/twitch/twitch-utils.js');
const { autoBan, targetFromChannel } = require('../../../util/moderation.js');
const { formatAutoBanReason } = require('../../../misc/ban-reason.js');
const { USERNAME_EVADER_PATTERNS, findEvaderPattern } = require('../../../misc/username-evader.js');

/**
 * Bannt User, deren Username ein bekanntes Ban-Evader-Muster enthaelt (utils/username-evader.ts), aus sb-v2.
 *   userJoin  - Join-Poller
 *   lowTrust  - PubSub, feuert zuverlaessig bei der ersten Nachricht eines Twitch-markierten Users
 */

// login#channel - keine Doppel-Banversuche innerhalb einer Laufzeit
const banned = new Set();

const handle = async (platform, channel, login, userId) => {
	const key = `${login}#${channel.name}`;
	if (banned.has(key)) {
		return;
	}
	banned.add(key);
	if (banned.size > 10_000) {
		banned.clear();
	}

	const pattern = findEvaderPattern(channel.name, login);
	if (!pattern) {
		return;
	}

	console.warn(`[username-evader-ban] "${login}" matcht /${pattern.source}/ in #${channel.name}`);
	const id = userId ?? (await fetchTwitchUser(login).catch(() => null))?.id ?? null;
	if (!id) {
		console.warn(`[username-evader-ban] User-ID fuer ${login} nicht gefunden`);
		return;
	}

	const label = `Ban Evader - Username pattern: ${pattern.source}`;
	await autoBan(targetFromChannel(channel, id, login), {
		reason: formatAutoBanReason(label, platform.selfName),
		publicReason: label,
		status: 'USERNAME_EVADER',
	});
};

module.exports = defineChatModule({
	name: 'username-evader-ban',
	description: 'Bans ban evaders by username pattern - on join and on their first low-trust event.',
	scope: 'global',
	handlers: {
		userJoin: async (context) => {
			if (USERNAME_EVADER_PATTERNS[context.channel.name] && context.channel.mode === 'Moderator') {
				await handle(bot.Twitch, context.channel, context.userName, null);
			}
		},
		lowTrust: async (context) => {
			const { channel } = context;
			if (!channel || !USERNAME_EVADER_PATTERNS[channel.name] || channel.mode !== 'Moderator') {
				return;
			}

			const payload = context.payload;
			const data = payload?.data;
			if (!data || payload.type !== 'low_trust_user_new_message') {
				return;
			}

			const ltu = data.low_trust_user ?? {};
			const login = ltu.sender?.login ?? data.target_user ?? ltu.login ?? ltu.user_login;
			const userId = ltu.sender?.user_id ?? data.target_user_id ?? ltu.id ?? ltu.user_id ?? null;
			if (login) {
				await handle(bot.Twitch, channel, login.toLowerCase(), userId);
			}
		},
	},
});
