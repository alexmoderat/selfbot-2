const { listOrLink } = require('../util/list-reply.js');
const { addToWatchlist, getWatchlist, removeFromWatchlist } = require('../util/watchlist.js');

/**
 * Eigene "suspicious chatter"-Liste je Channel, rein informativ, aus sb-v2. Twitchs natives Feature hat keine
 * oeffentliche API, nur eine interne GQL-Mutation - statt das nachzubauen ein Merkzettel fuer Mods.
 */
const command = {
	name: 'watchlist',
	aliases: ['suspicious'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Manages a per-channel watchlist of suspicious chatters (informational only).',
	usage: 'watchlist add <user> [reason] | watchlist remove <user> | watchlist list',
	execute: async ({ client, message: msg }) => {
		const [sub, target, ...rest] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		const action = sub?.toLowerCase();
		if (!channel) {
			return `@${display}, this only works in a channel.`;
		} else if (action !== 'add' && action !== 'remove' && action !== 'list') {
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} add <user> [reason] | remove <user> | list`;
		}

		if (action === 'list') {
			const entries = await getWatchlist(channel);
			if (entries.length === 0) {
				return `@${display}, watchlist is empty.`;
			}

			const names = entries.map((i) => i.Login + (i.Reason ? ` — ${i.Reason}` : ''));
			return `@${display}, watchlist (${entries.length}): ${await listOrLink(entries.length > 5 ? names : entries.map((i) => i.Login), `Watchlist #${channel.name}`)}`;
		}

		const login = target
			?.toLowerCase()
			.replace(/^[@#]+/, '')
			.trim();
		if (!login) {
			return `@${display}, Usage: ${msg.prefix}${msg.invocation} ${action} <user>`;
		}

		if (action === 'add') {
			await addToWatchlist(channel, login, rest.join(' ').trim() || null, display);
			return `@${display}, ${login} added to watchlist.`;
		}

		const removed = await removeFromWatchlist(channel, login);
		return removed ? `@${display}, ${login} removed from watchlist.` : `@${display}, ${login} was not on the watchlist.`;
	},
};

module.exports = { command };
