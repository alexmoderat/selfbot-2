const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { formatTopClip, mostRecent } = require('../misc/topclips.js');
const { packLines, replyInChunks } = require('../misc/tracking-format.js');
const { fetchClips } = require('../misc/twitch-info.js');

/**
 * Die zuletzt erstellten Clips eines Channels, aus sb-v2 (ninou2, 17.10.2026). "!lc" = der neueste, "!lc 5" = die
 * letzten 5 als Liste, "!lc #5" = nur der an Position 5; Channel und Zahl in beliebiger Reihenfolge.
 */
const DEFAULT_COUNT = 1;
const MAX_COUNT = 10;
const FETCH = 100;
const MSG_LIMIT = 450;

const parseLastClipsArgs = (words) => {
	let count;
	let rank;
	let channel;
	for (const word of words) {
		const hashMatch = /^#(\d{1,2})$/.exec(word);
		if (rank === undefined && hashMatch && Number(hashMatch[1]) >= 1 && Number(hashMatch[1]) <= MAX_COUNT) {
			rank = Number(hashMatch[1]);
		} else if (count === undefined && /^\d+$/.test(word) && Number(word) >= 1 && Number(word) <= MAX_COUNT) {
			count = Number(word);
		} else if (channel === undefined) {
			channel = word;
		}
	}
	return { count, rank, channel };
};

module.exports = {
	name: 'lastclips',
	aliases: ['recentclips', 'newclips', 'lc'],
	cooldown: 3000,
	description:
		'Shows the single most recently created clip of a channel, or "1-10" for a list, or "#1-10" for just that specific one. Defaults to the current channel.',
	usage: 'lastclips [channel] [1-10 | #1-10]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const words = [...msg.args];
		const display = msg.displayName;
		const args = parseLastClipsArgs(words);
		const channel = (args.channel ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();

		const user = channel ? await fetchTwitchUser(channel).catch(() => null) : null;
		if (!user) {
			return { text: `@${display}, channel "${channel}" not found.` };
		}

		const list = await fetchClips(user.id, FETCH);
		if (list.length === 0) {
			return { text: `@${display}, #${channel} has no clips yet.` };
		}

		if (args.rank !== undefined) {
			const ranked = mostRecent(list, args.rank);
			if (ranked.length < args.rank) {
				return { text: `@${display}, #${channel} only has ${ranked.length} clip${ranked.length === 1 ? '' : 's'}.` };
			}
			return { text: `@${display}, in #${channel}: ${formatTopClip(args.rank, ranked[args.rank - 1])}` };
		}

		const recent = mostRecent(list, args.count ?? DEFAULT_COUNT);
		const head = `@${display}, last ${recent.length} clip${recent.length === 1 ? '' : 's'} in #${channel}: `;
		// ninou2, 17.10.2026: Kopf nur in der ersten Nachricht
		const chunks = packLines(
			head,
			recent.map((i, index) => formatTopClip(index + 1, i)),
			MSG_LIMIT,
			' | ',
			false,
		);
		return await replyInChunks(msg, chunks);
	},
};

Object.assign(module.exports, { parseLastClipsArgs });
