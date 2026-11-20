const { uploadList } = require('../token/haste.js');
const { FOLLOWERS_CAP, fetchFollowers } = require('../token/twitch-lists.js');

/** Follower eines Accounts (sb-v2): Zahl immer, Login-Liste nur, wo der Bot moddet */
module.exports = {
	name: 'followers',
	aliases: ['fol'],
	cooldown: 3000,
	description: 'Follower count of an account, with login list where the bot mods.',
	usage: 'followers [user]',
	flags: ['mod'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const login = (target ?? msg.sender.name).replace(/^[@#]+/, '').toLowerCase();

		let res;
		try {
			res = await fetchFollowers(login);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.warn(`[followers] ${login}: ${message}`);
			return { text: `@${display}, ${message}` };
		}

		if (!res) {
			return { text: `@${display}, user "${login}" not found.` };
		}

		const count = res.total.toLocaleString('en-US');
		if (res.names.length === 0) {
			// Kein Fehler: die Liste gibt es nur fuer Moderatoren des Channels
			return { text: `@${display}, ${login}: ${count} follower(s)` };
		}

		const capped = res.names.length >= FOLLOWERS_CAP ? ` (latest ${FOLLOWERS_CAP})` : '';
		try {
			const url = await uploadList(`Followers ${login} (latest first)`, res.names);
			return { text: `@${display}, ${login}: ${count} follower(s)${capped} — ${url}` };
		} catch {
			return { text: `@${display}, ${login}: ${count} follower(s)` };
		}
	},
};
