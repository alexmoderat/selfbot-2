const { setTimeout: sleep } = require('node:timers/promises');
const { getLongestSubRange } = require('../services/channel-stats.js');
const { packLines } = require('../misc/tracking-format.js');

/**
 * Rangliste der laengsten gesehenen Subs (Bereich "5-25" oder "N", bis 100), ueber mehrere Nachrichten statt
 * abzuschneiden (ninou2, 12.10.2026: "didnt complete the list tho"), aus sb-v2
 */
const MAX_RANGE = 100;
const MESSAGE_LIMIT = 480;
const SEND_DELAY = 400;

module.exports = {
	name: 'longestsubtop',
	cooldown: 3000,
	description: `Leaderboard of the longest sub streaks ever seen (any channel, split over several messages if needed, up to ${MAX_RANGE}). Takes a rank range (e.g. "5-25") or a count.`,
	usage: 'longestsubtop [N | from-to]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [rangeRaw] = msg.args;
		const display = msg.displayName;
		const raw = rangeRaw ?? '10';
		const single = /^\d+$/.test(raw);
		const match = single ? null : raw.match(/^(\d+)-(\d+)$/);
		if (!single && !match) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} <N> (top N) or <from>-<to> (e.g. 10, 1-10 or 5-25)` };
		}

		const from = single ? 1 : Number.parseInt(match?.[1] ?? '1', 10);
		let to = single ? Number.parseInt(raw, 10) : Number.parseInt(match?.[2] ?? '1', 10);
		if (from < 1 || to < from) {
			return { text: `@${display}, invalid range.` };
		}
		if (to - from + 1 > MAX_RANGE) {
			to = from + MAX_RANGE - 1;
		}

		const entries = await getLongestSubRange(from, to);
		if (entries.length === 0) {
			return { text: `@${display}, no entries in that range.` };
		}

		const lines = entries.map((e, i) => `${from + i}. @${e.username} (${e.max_months}mo) in @${e.channel}`);
		const chunks = packLines(`@${display}, longest subs rank ${from}-${from + entries.length - 1}: `, lines, MESSAGE_LIMIT, ' // ', false);
		if (chunks.length === 1) {
			return { text: chunks[0] };
		}

		for (let i = 0; i < chunks.length; i++) {
			if (i > 0) {
				await sleep(SEND_DELAY);
			}
			await msg.send(chunks[i]);
		}

		return { text: null };
	},
};
