const { got } = require('./got.js');
const { readFileSync } = require('node:fs');

// Zugriff auf den eigenen Chat-Logger justlog (127.0.0.1:8025, Admin-API), aus sb-v2s v2/utils/justlog.ts.

const JUSTLOG_CONFIG = process.env.JUSTLOG_CONFIG || '/root/justlog/config.json';
const JUSTLOG_URL = process.env.JUSTLOG_URL || 'http://127.0.0.1:8025';

const readAdminKey = () => {
	try {
		const config = JSON.parse(readFileSync(JUSTLOG_CONFIG, 'utf8'));
		return config.adminAPIKey || null;
	} catch {
		return null;
	}
};

/** User-IDs, die in justlogs config.json stehen */
const configuredChannelIds = () => {
	try {
		const config = JSON.parse(readFileSync(JUSTLOG_CONFIG, 'utf8'));
		return new Set(config.channels ?? []);
	} catch {
		return null;
	}
};

/** Channels, die der Logger gerade fuehrt */
const currentChannels = async () => {
	const response = await got('Global')({
		url: `${JUSTLOG_URL}/channels`,
		timeout: { request: 15_000 },
	});

	if (!response.ok) {
		throw new Error(`justlog /channels: ${response.statusCode}`);
	}

	return response.body.channels ?? [];
};

/** Logins zu User-IDs, je 100 gebuendelt; nicht auffindbare fallen still raus */
const resolveIds = async (logins) => {
	const ids = [];
	for (let i = 0; i < logins.length; i += 100) {
		const response = await got('Helix')({
			url: 'users',
			searchParams: new URLSearchParams(logins.slice(i, i + 100).map((login) => ['login', login])),
		});

		ids.push(...(response.body.data ?? []).map((u) => u.id));
	}

	return ids;
};

const callAdmin = async (method, ids, key) => {
	const response = await got('Global')({
		method,
		url: `${JUSTLOG_URL}/admin/channels`,
		headers: { 'X-Api-Key': key },
		json: { channels: ids },
		responseType: 'text',
		timeout: { request: 30_000 },
	});

	if (!response.ok) {
		throw new Error(`justlog admin ${method}: ${response.statusCode}`);
	}
};

const getExtras = async () => (await bot.DB.JustlogExtra.find({}, { channelName: 1 }).sort({ channelName: 1 }).lean()).map((i) => i.channelName);

const addExtra = async (channel) => {
	await bot.DB.JustlogExtra.updateOne({ channelName: channel }, { $setOnInsert: { channelName: channel, added: new Date() } }, { upsert: true });
};

/** true, wenn es einen Eintrag gab */
const removeExtra = async (channel) => (await bot.DB.JustlogExtra.deleteOne({ channelName: channel })).deletedCount > 0;

module.exports = { JUSTLOG_CONFIG, JUSTLOG_URL, readAdminKey, configuredChannelIds, currentChannels, resolveIds, callAdmin, getExtras, addExtra, removeExtra };
