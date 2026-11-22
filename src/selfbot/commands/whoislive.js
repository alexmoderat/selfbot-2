const { got } = require('../token/got.js');

const { uploadToOwnHaste } = require('../token/haste.js');
const { formatListPage } = require('../util/list-reply.js');

/**
 * Welche der eigenen Channels gerade live sind, mit Laufzeit in vollen Stunden (ninou2, 07.11.2026: "make it a command",
 * "!whoislive !wil", "make it @ the streamers and beside their @ add for how long has been [2h]", "it show only the hours").
 * Laengste Streams zuerst. Passt die Liste nicht in eine Nachricht, kommt sie als Link (alexmoderat, 24.10.2026).
 */
const MESSAGE_LIMIT = 480;

/**
 * "@ninou2 [2h]" - volle Stunden, abgerundet; unter einer Stunde Minuten, "[15m]" (ninou2, 07.11.2026: "but if the
 * streamer has been [less] than 1h it show the minutes", "only"); laengste zuerst
 */
const formatLiveList = (streams, now = Date.now()) =>
	[...streams]
		.map((i) => ({ login: i.login, minutes: Math.max(0, Math.floor((now - new Date(i.startedAt).getTime()) / 6e4)) }))
		.sort((a, b) => b.minutes - a.minutes || a.login.localeCompare(b.login))
		.map((i) => `@${i.login} [${i.minutes < 60 ? `${i.minutes}m` : `${Math.floor(i.minutes / 60)}h`}]`);

/** ninou2, 07.11.2026: "make it like this : @alexmoderat [34h] // @pearsbott [17h] //", "might [be] cleaner" */
const SEPARATOR = ' // ';

/** ninou2, 21.11.2026: "to add the total combine views the channels" -> "--- TOTAL Viewers : [167]" */
const totalViewers = (streams) => ` --- TOTAL Viewers : [${streams.reduce((sum, i) => sum + (i.viewers ?? 0), 0)}]`;

const liveHead = (count) => (count === 1 ? '1 channel with the bot is live! :' : `${count} channels with the bot are live! :`);

const fetchLiveStreams = async (ids) => {
	const result = [];
	for (let i = 0; i < ids.length; i += 100) {
		const response = await got('Helix')({
			url: 'streams',
			searchParams: new URLSearchParams([...ids.slice(i, i + 100).map((id) => ['user_id', id]), ['first', '100']]),
		});
		if (!response.ok) {
			throw new Error(`Helix streams: ${response.statusCode}`);
		}
		for (const stream of response.body.data ?? []) {
			result.push({ login: stream.user_login, startedAt: stream.started_at, viewers: stream.viewer_count ?? 0 });
		}
	}

	return result;
};

module.exports = {
	name: 'whoislive',
	aliases: ['wil'],
	cooldown: 5000,
	description: "Lists which of the bot's channels are live right now, with how many hours they've been live.",
	usage: 'whoislive',
	execute: async (client, msg) => {
		const display = msg.displayName;
		const twitch = bot.Twitch;
		const ids = bot.Channels.getJoinable()
			.map((i) => i.twitchId)
			.filter((i) => Boolean(i));

		const streams = await fetchLiveStreams(ids);
		const items = formatLiveList(streams);
		if (items.length === 0) {
			return { text: `@${display}, nobody is live right now.` };
		}

		// ninou2, 07.11.2026: "12 channels with the bot are live! :"
		const head = `@${display}, ${liveHead(items.length)} `;
		const total = totalViewers(streams);
		const inline = head + items.join(SEPARATOR) + total;
		if (inline.length <= MESSAGE_LIMIT) {
			return { text: inline };
		}

		try {
			return { text: head + (await uploadToOwnHaste(formatListPage('Live channels', items))) + total };
		} catch {
			return { text: `${inline.slice(0, MESSAGE_LIMIT - 1)}…` };
		}
	},
};

Object.assign(module.exports, { formatLiveList, SEPARATOR, liveHead, totalViewers, fetchLiveStreams });
