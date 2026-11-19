const { getRecord } = require('../services/channel-stats.js');
const { uploadToOwnHaste } = require('../misc/haste.js');
const { formatListPage } = require('../misc/list-reply.js');

/**
 * Rekord an gleichzeitig live Channels (Cron live-record) mit Datum und Channels (ninou2, 18.11.2026: "a create a command
 * that save the best !wil", "AND who were live, with date", "!whoislivebest !wilb", Antwort "the most number channels
 * with the bot modded that were live at one time was recorded on 13 november 2025 with 13 channel : @ @ @ their @").
 * Passt die Liste nicht in eine Nachricht, kommt sie als Link (alexmoderat, 24.10.2026).
 */
const MESSAGE_LIMIT = 480;

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st, 22nd, 23rd ... */
const ordinal = (n) => {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) {
		return `${n}th`;
	}
	return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

/**
 * "the 18th november 2026 UTC" (ninou2, 19.11.2026: "woud be better if the date will be : on the 19th november 2026",
 * "AND u add UTC", "AND the date get : rd/th at the end the day date")
 */
const formatRecordDate = (date) => {
	const d = new Date(date);
	const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
	return `the ${ordinal(d.getUTCDate())} ${month} ${d.getUTCFullYear()} UTC`;
};

const recordHead = (record) =>
	`the most number of channels with the bot that were live at one time was recorded on ${formatRecordDate(record.Achieved)} with ${record.Value} ${record.Value === 1 ? 'channel' : 'channels'}`;

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
		const inline = `${head} : ${items.join(' ')}`;
		if (inline.length <= MESSAGE_LIMIT) {
			return { text: inline };
		}

		try {
			return { text: `${head} : ${await uploadToOwnHaste(formatListPage('Live record', items))}` };
		} catch {
			return { text: `${inline.slice(0, MESSAGE_LIMIT - 1)}…` };
		}
	},
};

Object.assign(module.exports, { formatRecordDate, recordHead, ordinal });
