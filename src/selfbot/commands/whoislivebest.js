const { getRecord } = require('../util/channel-stats.js');
const { chunkMessages } = require('../util/list-reply.js');

/**
 * Rekord an gleichzeitig live Channels (Cron live-record) mit Datum und Channels (ninou2, 18.11.2026: "a create a command
 * that save the best !wil", "AND who were live, with date", "!whoislivebest !wilb", Antwort "the most number channels
 * with the bot modded that were live at one time was recorded on 13 november 2025 with 13 channel : @ @ @ their @").
 * Passt die Liste nicht in eine Nachricht, auf mehrere verteilt statt als Link (alexmoderat, 22.11.2026: "ninou mag es
 * nicht als link", "Ja, beide auch").
 */
const MESSAGE_LIMIT = 480;
const MESSAGE_GAP_MS = 1_200;

/** Eine Nachricht als Antwort, mehrere direkt nacheinander in den Channel */
const replyMessages = async (msg, messages) => {
	if (messages.length === 1) {
		return { text: messages[0] };
	}
	for (const [i, text] of messages.entries()) {
		if (i > 0) {
			await new Promise((resolve) => setTimeout(resolve, MESSAGE_GAP_MS));
		}
		await bot.Channels.send(msg.channelData, text);
	}
	return { success: true, text: null };
};

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st, 22nd, 23rd ... */
const ordinal = (n) => {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) {
		return `${n}th`;
	}
	return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

/**
 * "the 18th november 2026 at 16:02 UTC" (ninou2, 19.11.2026: "woud be better if the date will be : on the 19th november 2026",
 * "AND u add [Uhrzeit] UTC", "AND the date get : rd/th at the end the day date"; dann: "didnt the UTC numbers" - also mit
 * Uhrzeit in UTC, nicht nur dem Wort)
 */
const formatRecordDate = (date) => {
	const d = new Date(date);
	const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
	const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
	return `the ${ordinal(d.getUTCDate())} ${month} ${d.getUTCFullYear()} at ${time} UTC`;
};

// Anzahl in eckigen Klammern (ninou2, 19.11.2026: "[18 channels]", "between brackets")
const recordHead = (record) =>
	`the most number of channels with the bot that were live at one time was recorded on ${formatRecordDate(record.Achieved)} with [${record.Value} ${record.Value === 1 ? 'channel' : 'channels'}]`;

module.exports = {
	name: 'whoislivebest',
	aliases: ['wilb'],
	cooldown: 5000,
	description: 'Shows the record of how many channels with the bot were live at the same time, when it happened and who was live.',
	usage: 'whoislivebest',
	execute: async (client, msg) => {
		const display = msg.displayName;
		const record = await getRecord('live_channels');
		if (!record) {
			return { text: `@${display}, no record yet.` };
		}

		const head = `@${display}, ${recordHead(record)}`;
		const channels = Array.isArray(record.Channels) ? [...record.Channels].sort((a, b) => a.localeCompare(b)) : [];
		if (channels.length === 0) {
			// Rekorde vor dem 18.11.2026 haben keine Channel-Liste
			return { text: `${head} (the channels weren't saved for this record).` };
		}

		const items = channels.map((i) => `@${i}`);
		return replyMessages(msg, chunkMessages(`${head} : `, items, ' ', MESSAGE_LIMIT));
	},
};

Object.assign(module.exports, { formatRecordDate, recordHead, ordinal, replyMessages });
