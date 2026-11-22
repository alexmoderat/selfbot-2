const { getRecord } = require('../util/channel-stats.js');
const { chunkMessages } = require('../util/list-reply.js');
const { formatRecordDate, replyMessages } = require('./whoislivebest.js');
const { SEPARATOR } = require('./whoislive.js');

/**
 * Rekord der Gesamt-Viewer aller gleichzeitig live Channels (Cron live-record, seit 22.11.2026), wie !wilb, aber fuer das
 * "--- TOTAL Viewers" aus !wil (ninou2, 22.11.2026: "!wilbv", "the viewers best recorded"). Channels mit ihren Viewern im
 * !wil-Stil "@x [300] // @y [120]", meiste zuerst. Passt das nicht in eine Nachricht, auf mehrere verteilt statt als Link
 * (alexmoderat, 22.11.2026: "ninou mag es nicht als link").
 */
const MESSAGE_LIMIT = 480;

const viewersHead = (record) =>
	`the most total viewers of the channels with the bot that were live at one time was recorded on ${formatRecordDate(record.Achieved)} with [${record.Value} ${record.Value === 1 ? 'viewer' : 'viewers'}]`;

const formatViewerList = (channels) => channels.map((i) => `@${i.login} [${i.viewers}]`);

module.exports = {
	name: 'whoislivebestviewers',
	aliases: ['wilbv'],
	cooldown: 5000,
	description: 'Shows the record of total viewers across all channels with the bot that were live at the same time, when it happened and who was live.',
	usage: 'whoislivebestviewers',
	execute: async (client, msg) => {
		const display = msg.displayName;
		const record = await getRecord('live_viewers');
		if (!record) {
			return { text: `@${display}, no viewer record yet.` };
		}

		const head = `@${display}, ${viewersHead(record)}`;
		const items = formatViewerList(Array.isArray(record.Channels) ? record.Channels : []);
		if (items.length === 0) {
			return { text: head };
		}

		return replyMessages(msg, chunkMessages(`${head} : `, items, SEPARATOR, MESSAGE_LIMIT));
	},
};

Object.assign(module.exports, { viewersHead, formatViewerList });
