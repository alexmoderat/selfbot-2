const { getRecord } = require('../util/channel-stats.js');
const { uploadToOwnHaste } = require('../token/haste.js');
const { formatListPage } = require('../util/list-reply.js');
const { formatRecordDate } = require('./whoislivebest.js');
const { SEPARATOR } = require('./whoislive.js');

/**
 * Rekord der Gesamt-Viewer aller gleichzeitig live Channels (Cron live-record, seit 22.11.2026), wie !wilb, aber fuer das
 * "--- TOTAL Viewers" aus !wil (ninou2, 22.11.2026: "!wilbv", "the viewers best recorded"). Channels mit ihren Viewern im
 * !wil-Stil "@x [300] // @y [120]", meiste zuerst; passt das nicht in eine Nachricht, als Link (alexmoderat, 24.10.2026).
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

		const inline = `${head} : ${items.join(SEPARATOR)}`;
		if (inline.length <= MESSAGE_LIMIT) {
			return { text: inline };
		}

		try {
			return { text: `${head} : ${await uploadToOwnHaste(formatListPage('Viewer record', items))}` };
		} catch {
			return { text: `${inline.slice(0, MESSAGE_LIMIT - 1)}…` };
		}
	},
};

Object.assign(module.exports, { viewersHead, formatViewerList });
