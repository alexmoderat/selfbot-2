const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { formatDuration } = require('../misc/duration.js');

/**
 * Der am laengsten folgende User eines Channels, aus sb-v2 (Block 7: sb-v2-Version). Supibot fragt GQL
 * followers(first:1), das liefert inzwischen leer; Helix liefert neueste zuerst und braucht Mod-Rechte, also bis zur
 * letzten Seite blaettern - gedeckelt.
 */
const PAGE = 100;
const MAX_PAGES = 20;

module.exports = {
	name: 'firstchannelfollower',
	aliases: ['fcf'],
	cooldown: 3000,
	description: 'Fetches the longest-standing follower of a channel (up to 2000 followers; needs the bot to be a mod there).',
	usage: 'firstchannelfollower [channel]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const name = (targetRaw ?? msg.sender.name).replace(/^[#@]/, '').toLowerCase();
		const user = await fetchTwitchUser(name).catch(() => null);
		if (!user) {
			return { text: `@${display}, could not match user to a Twitch user ID!` };
		}

		let last;
		let cursor;
		for (let page = 0; page < MAX_PAGES; page++) {
			const response = await got('Helix')({
				url: 'channels/followers',
				searchParams: { broadcaster_id: user.id, first: PAGE, ...(cursor ? { after: cursor } : {}) },
			});
			if (!response.ok) {
				return {
					text: `@${display}, no follower data available for ${name === msg.sender.name ? 'you' : 'that channel'} (the bot needs to be a mod there).`,
				};
			}

			const body = response.body;
			if (body.data.length === 0) {
				break;
			}
			last = body.data.at(-1);
			cursor = body.pagination?.cursor;
			if (!cursor) {
				break;
			}
			if (page === MAX_PAGES - 1) {
				return { text: `@${display}, ${body.total ?? 'too many'} followers — too many to search the oldest one.` };
			}
		}

		if (!last?.followed_at) {
			return { text: `@${display}, no followers found.` };
		}

		const who = last.user_login === msg.sender.name ? 'you!' : `@${last.user_login}`;
		return {
			text: `@${display}, the longest still following user is ${who}, since ${formatDuration(Date.now() - new Date(last.followed_at).getTime())} ago.`,
		};
	},
};
