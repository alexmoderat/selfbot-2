const { got } = require('../token/got.js');
const { ago } = require('../misc/duration.js');

/**
 * Letzter (Nicht-Retweet-)Tweet eines X-Accounts, aus sb-v2 (ninou2, 10.10.2026). Quelle ist Supinics oeffentliche
 * API supinic.com/api/twitter/syndication/<user> - keine X-API-Kosten.
 */

module.exports = {
	name: 'tweet',
	aliases: ['twitter'],
	cooldown: 3000,
	description: 'Shows the latest tweet (excluding retweets) from a given X/Twitter account.',
	usage: 'tweet <username>',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [usernameRaw] = msg.args;
		const display = msg.displayName;
		if (!usernameRaw) {
			return { text: `@${display}, usage: !tweet <username>` };
		}
		const username = usernameRaw.trim().replace(/^@/, '');

		let timeline;
		try {
			const response = await got('GenericAPI')({
				url: `https://supinic.com/api/twitter/syndication/${encodeURIComponent(username)}`,
				headers: { 'User-Agent': 'Mozilla/5.0' },
				timeout: { request: 8000 },
			});
			timeline = response.body.data?.timeline ?? [];
		} catch {
			return { text: `@${display}, could not fetch tweets right now — try again later.` };
		}

		// Retweets ausgeschlossen, wie Supibots $tweet standardmaessig
		const latest = timeline.find((i) => !i.retweeted_status);
		if (!latest) {
			return { text: `@${display}, no recent tweets found for "${username}".` };
		}

		const text = String(latest.full_text ?? '')
			.replace(/\s+/g, ' ')
			.trim();
		return { text: `@${display}, @${username}: ${text} — https://twitter.com${latest.permalink} (posted ${ago(latest.created_at, false)} ago)` };
	},
};
