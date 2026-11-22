const { Logger } = require('../misc/logger.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { uploadList } = require('../token/haste.js');
const { CHATTERS_CAP, fetchChatters, fetchChattersGql } = require('../token/twitch-lists.js');

/** Chatter-Liste eines Channels (sb-v2): Helix, wo der Bot moddet, sonst SmartBox-GQL */
const command = {
	name: 'chatters',
	aliases: ['ch'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: "Counts a channel's chatters and uploads the login list.",
	usage: 'chatters [channel]',
	execute: async ({ client, message: msg }) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const channel = (target ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const user = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		if (!user) {
			return `@${display}, channel "${channel}" not found.`;
		}

		let res;
		try {
			res = await fetchChatters(user.id, bot.Twitch.selfId);
			if (res.forbidden) {
				res = (await fetchChattersGql(channel)) ?? res;
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			Logger.warn(`[chatters] ${channel}: ${message}`);
			return `@${display}, ${message}`;
		}

		if (res.forbidden) {
			return `@${display}, no mod rights in #${channel} — Twitch only gives out the chatter list to moderators.`;
		}
		if (res.names.length === 0) {
			return `@${display}, #${channel}: 0 chatter(s)`;
		}

		const sorted = res.names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
		const capped = res.names.length >= CHATTERS_CAP ? ` (capped at ${CHATTERS_CAP})` : '';
		try {
			const url = await uploadList(`Chatters #${channel}`, sorted);
			return `@${display}, #${channel}: ${res.total.toLocaleString('en-US')} chatter(s)${capped} — ${url}`;
		} catch {
			return `@${display}, #${channel}: ${res.total.toLocaleString('en-US')} chatter(s)${capped} (upload failed)`;
		}
	},
};

module.exports = { command };
