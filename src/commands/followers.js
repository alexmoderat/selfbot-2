const { Logger } = require('../misc/logger.js');
const { uploadList } = require('../token/haste.js');
const { FOLLOWERS_CAP, fetchFollowers } = require('../token/twitch-lists.js');

/** Follower eines Accounts (sb-v2): Zahl immer, Login-Liste nur, wo der Bot moddet */
const command = {
	name: 'followers',
	aliases: ['fol'],
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Follower count of an account, with login list where the bot mods.',
	usage: 'followers [user]',
	execute: async ({ client, message: msg }) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const login = (target ?? msg.sender.name).replace(/^[@#]+/, '').toLowerCase();

		let res;
		try {
			res = await fetchFollowers(login);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			Logger.warn(`[followers] ${login}: ${message}`);
			return `@${display}, ${message}`;
		}

		if (!res) {
			return `@${display}, user "${login}" not found.`;
		}

		const count = res.total.toLocaleString('en-US');
		if (res.names.length === 0) {
			// Kein Fehler: die Liste gibt es nur fuer Moderatoren des Channels
			return `@${display}, ${login}: ${count} follower(s)`;
		}

		const capped = res.names.length >= FOLLOWERS_CAP ? ` (latest ${FOLLOWERS_CAP})` : '';
		try {
			const url = await uploadList(`Followers ${login} (latest first)`, res.names);
			return `@${display}, ${login}: ${count} follower(s)${capped} — ${url}`;
		} catch {
			return `@${display}, ${login}: ${count} follower(s)`;
		}
	},
};

module.exports = { command };
