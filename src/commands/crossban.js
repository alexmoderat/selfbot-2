const { setTimeout: sleep } = require('node:timers/promises');
const { banUser, resolveTarget } = require('../services/moderation.js');
const { fetchModeratedChannels, fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { formatAutoBanReason } = require('../misc/ban-reason.js');

const BAN_DELAY = 650; // gleiches Tempo wie massban, der Ratelimit-Bucket ist token-gebunden

/**
 * Bannt einen User in allen moderierten Channels, die per !crossbanoptin zugestimmt haben (aus sb-v2).
 * alexmoderat, 11.09.2026: "Ich will ihn ja nicht in allen meinen moderated channels bannen nur in opted in channels".
 */
module.exports = {
	name: 'crossban',
	aliases: ['cb'],
	cooldown: 3000,
	description: 'Bans one user across every channel this bot moderates.',
	usage: 'crossban <username|user_id> [reason]',
	flags: ['owner'],
	execute: async (client, msg) => {
		const [target, ...reasonWords] = msg.args;
		const display = msg.displayName;

		// Erst als Login aufloesen, nicht per /^\d+$/ raten - Twitch erlaubt rein numerische Logins (Vorfall 11.09.2026)
		const login = (target ?? '').replace('@', '').toLowerCase();
		const user = await fetchTwitchUser(login);
		const userId = user?.id ?? (/^\d+$/.test(login) ? login : null);
		if (!userId) {
			return { text: `@${display}, user "${target}" not found.` };
		}

		// "Cross-ban" immer im Grund, sonst erkennt ein Mod im Modlog nicht, woher der Ban kommt (21.09.2026)
		const customReason = reasonWords.join(' ').trim();
		const reason = formatAutoBanReason(customReason ? `Cross-ban: ${customReason}` : 'Cross-ban', bot.Twitch.selfName);

		const moderated = await fetchModeratedChannels(bot.Twitch.selfId);
		if (moderated === null) {
			return { text: `@${display}, could not fetch the moderated channel list right now.` };
		}

		// Der eigene Channel taucht nicht in "moderated" auf (Broadcaster ist kein Mod seiner selbst, Vorfall 11.09.2026)
		const home = bot.Twitch.selfName;
		const candidates = [...new Set([...moderated.map((i) => i.login), home])];
		const channels = [];
		for (const name of candidates) {
			const channel = bot.Channels.get(name);
			if (channel && (await bot.Channels.getData(channel, 'crossbanOptIn')) === true) {
				channels.push(name);
			}
		}

		if (channels.length === 0) {
			return { text: `@${display}, no channels opted in — a channel's mods need to run crossbanoptin on first.` };
		}

		await msg.send(
			`@${display}, banning ${target} (${userId}) in ${channels.length} channel(s) — this'll take about ${Math.ceil((channels.length * BAN_DELAY) / 60_000)} min.`,
		);

		let banned = 0;
		let failed = 0;
		for (const channelName of channels) {
			const banTarget = await resolveTarget(channelName, userId, user?.login ?? login);
			const ok = banTarget ? await banUser(banTarget, { reason, status: 'CROSSBAN' }) : false;
			if (ok) {
				banned++;
			} else {
				failed++;
			}

			await sleep(BAN_DELAY);
		}

		return { text: `@${display}, crossban done — banned ${target} in ${banned}/${channels.length} channel(s)${failed ? `, ${failed} failed` : ''}.` };
	},
};
