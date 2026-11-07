const { setTimeout: sleep } = require('node:timers/promises');
const { getTopChatters, getTopWatchtime, isKnownBot } = require('../services/channel-stats.js');
const { formatHours, packLines } = require('../misc/tracking-format.js');

/**
 * Rangliste Watchtime, Offline-Zeit oder Nachrichten im Channel (Bots ausgenommen, bis 50, ueber mehrere Nachrichten
 * statt Haste-Link - ninou2, 24.09.2026: "ohne hatebin"), aus sb-v2. Nachrichten zaehlt jetzt Message_Meta_User_Alias
 * (Supibot-Modell) statt eines GROUP BY ueber das ganze Log.
 */
const DEFAULT_COUNT = 10;
const MAX_COUNT = 50;
const FETCH_COUNT = 150; // vor dem Bot-Filter, damit danach noch genug uebrig bleiben
const MESSAGE_LIMIT = 480;
const SEND_DELAY = 400;

const withoutBots = async (rows) => {
	const result = [];
	for (const row of rows) {
		if (!(await isKnownBot(row.name))) {
			result.push(row);
		}
	}

	return result;
};

module.exports = {
	name: 'leaderboard',
	aliases: ['lb', 'top'],
	cooldown: 3000,
	description: `Top watchtime, offlinetime or messages leaderboard (bots excluded, up to ${MAX_COUNT}, split over several messages) for the current channel.`,
	usage: `leaderboard [watchtime|offlinetime|messages] [1-${MAX_COUNT}]`,
	execute: async (client, msg) => {
		const [statRaw, countRaw] = msg.args;
		const display = msg.displayName;
		const channel = msg.channelData;
		if (!channel) {
			return { text: `@${display}, this only works in a channel.` };
		}

		// Erstes Argument darf schon die Zahl sein ("!top 25")
		const numberFirst = statRaw !== undefined && /^\d+$/.test(statRaw);
		const stat = (numberFirst ? 'watchtime' : (statRaw ?? 'watchtime')).toLowerCase();
		const countArg = numberFirst ? statRaw : countRaw;
		const count = countArg === undefined ? DEFAULT_COUNT : Number(countArg);
		const usage = `@${display}, Usage: ${msg.prefix}${msg.invocation} [watchtime|offlinetime|messages] [1-${MAX_COUNT}]`;
		if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
			return { text: usage };
		}

		const isOffline = ['offlinetime', 'offline', 'ot'].includes(stat);
		const isWatch = ['watchtime', 'watch', 'wt'].includes(stat);
		const isMessages = ['messages', 'message', 'msgs', 'chat', 'chatting'].includes(stat);
		if (!isOffline && !isWatch && !isMessages) {
			return { text: usage };
		}

		let label;
		let lines;
		if (isMessages) {
			const rows = await withoutBots((await getTopChatters(channel, FETCH_COUNT)).map((i) => ({ name: i.Name, count: Number(i.Count) })));
			if (rows.length === 0) {
				return { text: `@${display}, no messages logged for #${channel.name} yet.` };
			}

			label = 'chatters';
			lines = rows.slice(0, count).map((r, i) => `${i + 1}. ${r.name} (${r.count.toLocaleString('en-US')})`);
		} else {
			const raw = await getTopWatchtime(channel, isOffline, FETCH_COUNT);
			const rows = (await withoutBots(raw.map((i) => ({ name: i.Username, minutes: isOffline ? i.Offline_Minutes : i.Minutes })))).slice(0, count);
			if (rows.length === 0) {
				return { text: `@${display}, no ${isOffline ? 'offlinetime' : 'watchtime'} recorded for #${channel.name} yet.` };
			}

			label = isOffline ? 'offlinetime' : 'watchtime';
			lines = rows.map((r, i) => `${i + 1}. ${r.name} (${formatHours(r.minutes)})`);
		}

		const chunks = packLines(`@${display}, Top ${lines.length} ${label} in #${channel.name}: `, lines, MESSAGE_LIMIT, ', ', false);
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
