const { setTimeout: sleep } = require('node:timers/promises');
const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { getTopWatchStreaks } = require('../services/channel-stats.js');
const { formatShortDate, packLines, takeWithTies } = require('../misc/tracking-format.js');

/**
 * Hoechste gesehene Watch-Streaks in einem Channel oder ueberall, aus sb-v2. In sb-v2 nur vom utility-Bot beantwortet
 * (Massenerwaehnungen nicht vom Hauptaccount, ninou2/alexmoderat 06.10.2026) - der selfbot laeuft als Hauptaccount,
 * deshalb steht vstop in der config-Blacklist, solange der utility-Bot das uebernimmt.
 */
const DEFAULT_COUNT = 5;
const MAX_COUNT = 25;
const MESSAGE_LIMIT = 450;
const SEND_DELAY = 400;

module.exports = {
	name: 'vstop',
	cooldown: 3000,
	description: 'Top watch streaks the bot has seen in a channel (1-25, default 5; default channel is this one).',
	usage: 'vstop [1-25] [channel|all]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [countRaw, channelRaw] = msg.args;
		const display = msg.displayName;
		const isAll = channelRaw?.toLowerCase() === 'all';
		const name = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const count = countRaw === undefined ? DEFAULT_COUNT : Number(countRaw);
		if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
			return { text: `@${display}, Usage: ${msg.prefix}${msg.invocation} [1-${MAX_COUNT}] [channel]` };
		}

		let head;
		let lines;
		if (isAll) {
			const rows = takeWithTies(await getTopWatchStreaks(null, count * 4), count, (i) => Number(i.Best_Value));
			if (rows.length === 0) {
				return { text: `@${display}, no watch streaks recorded yet.` };
			}

			head = `@${display}, top watch streaks (all channels): `;
			// ninou2, 06./07.10.2026: Zuschauer und Channel erwaehnen, jeder Eintrag in [ ], Leerzeichen vor dem "]"
			lines = rows.map((r, i) => `[#${i + 1} @${r.Login} >${r.Best_Value}< (${formatShortDate(r.Best_Seen_At ?? r.Seen_At)}) in @${r.Channel_Name} ]`);
		} else {
			const channel = name ? await fetchTwitchUser(name).catch(() => null) : null;
			if (!channel) {
				return { text: `@${display}, failed to get broadcaster ID.` };
			}

			const rows = takeWithTies(await getTopWatchStreaks(channel.id, count), count, (i) => Number(i.Best_Value));
			if (rows.length === 0) {
				return { text: `@${display}, no watch streaks recorded in #${name} yet.` };
			}

			head = `@${display}, top ${rows.length} watch streaks in #${name}: `;
			lines = rows.map((r, i) => `[#${i + 1} @${r.Login} > ${r.Best_Value} < (${formatShortDate(r.Best_Seen_At ?? r.Seen_At)})]`);
		}

		const chunks = packLines(head, lines, MESSAGE_LIMIT);
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
