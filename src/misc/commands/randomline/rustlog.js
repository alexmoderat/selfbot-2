const { got } = require('../../../token/got.js');
const { commands } = require('../../../clients/modules/commands.js');
const SupiDate = require('../../date.js');

// Wie Supibots commands/randomline/rustlog.ts: Rustlog-kompatible Log-Dienste. Standard ist der eigene justlog
// (gleiche API wie Rustlog), danach IVR. Nur fuer Channels ohne eigenes Zeilen-Log (Logging ohne "Lines").

const INSTANCES = [
	{ name: 'justlog', url: process.env.JUSTLOG_URL || 'http://127.0.0.1:8025' },
	{ name: 'ivr', url: 'https://logs.ivr.fi' },
];
const CACHE_TTL = 60 * 60 * 1000;

let channelCache = null;

const getInstance = async (channelId) => {
	if (!channelCache || Date.now() - channelCache.at > CACHE_TTL) {
		const map = new Map();
		for (const instance of [...INSTANCES].reverse()) {
			// justlog zuletzt -> gewinnt
			const response = await got('Global')({
				url: `${instance.url}/channels`,
				timeout: { request: 10_000 },
			}).catch(() => null);

			for (const channel of response?.body.channels ?? []) {
				map.set(channel.userID, instance.url);
			}
		}

		channelCache = { at: Date.now(), map };
	}

	return channelCache.map.get(channelId) ?? null;
};

const isChannelSupported = async (channelId) => (await getInstance(channelId)) !== null;

const fetchRandom = async (path, channelId, notFound, optedOut) => {
	const url = await getInstance(channelId);
	if (!url) {
		return { success: false, text: 'Random lines are not available in this channel!' };
	}

	const response = await got('Global')({
		url: `${url}${path}`,
		searchParams: { json: '1' },
		timeout: { request: 10_000 },
	});

	if (response.statusCode === 403) {
		return { success: false, text: optedOut };
	} else if (response.statusCode === 404) {
		return { success: false, text: notFound };
	} else if (response.statusCode !== 200) {
		return { success: false, text: `The channel logs are not available at the moment (status code ${response.statusCode})! Try again later.` };
	}

	const message = response.body.messages?.at(0);
	if (!message) {
		return { success: false, text: `Couldn't fetch a random line! Try again in a little bit.` };
	}

	return { success: true, date: new SupiDate(message.timestamp), text: message.text, username: message.username };
};

const fetchRandomChannelLine = (channelId) =>
	fetchRandom(
		`/channelid/${channelId}/random`,
		channelId,
		'Could not load logs for that channel!',
		'This channel has opted out of having their messages logged via the third party log service!',
	);

const fetchRandomUserLine = (channelId, userId) =>
	fetchRandom(
		`/channelid/${channelId}/userid/${userId}/random`,
		channelId,
		'Could not load logs for that user!',
		'This user has opted out of having their messages logged via the third party log service!',
	);

module.exports = { isChannelSupported, fetchRandomChannelLine, fetchRandomUserLine };
