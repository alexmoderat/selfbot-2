const { got } = require('../token/got.js');

// Helix-Abfragen fuer Block 7 (Clips, Emotes, Channel-Infos, VODs), aus sb-v2s src/services/twitch-api.ts

/** Clips eines Channels (Helix "Get Clips", hoechstens 100 je Abfrage) */
const fetchClips = async (broadcasterId, first = 20, extra = {}) => {
	const response = await got('Helix')({
		url: 'clips',
		searchParams: { broadcaster_id: broadcasterId, first, ...extra },
	});
	if (!response.ok) {
		throw new Error(`Helix clips: ${response.statusCode}`);
	}
	return response.body.data;
};

/** Clip der letzten `duration` Sekunden erstellen und bis ~16 s auf die Verarbeitung warten (sb-v2s createClip) */
const createClip = async (broadcasterId, duration = 60, title) => {
	const response = await got('Helix')({
		method: 'POST',
		url: 'clips',
		searchParams: { broadcaster_id: broadcasterId, duration, ...(title ? { title } : {}) },
	});

	if (response.statusCode === 404) {
		return { error: 'offline' };
	} else if (response.statusCode === 403) {
		return { error: 'forbidden' };
	}

	const id = response.ok ? response.body.data?.[0]?.id : undefined;
	if (!id) {
		console.warn(`[twitch-info] createClip ${broadcasterId}: ${response.statusCode} ${JSON.stringify(response.body)}`);
		return { error: 'failed' };
	}

	for (let i = 0; i < 8; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		const check = await got('Helix')({ url: 'clips', searchParams: { id } }).catch(() => null);
		if (check?.ok && check.body.data.length > 0) {
			return { id, ready: true };
		}
	}

	return { id, ready: false };
};

/** Emotes eines Channels (Helix chat/emotes) */
const fetchChannelEmotes = async (broadcasterId) => {
	const response = await got('Helix')({
		url: 'chat/emotes',
		searchParams: { broadcaster_id: broadcasterId },
	});
	if (!response.ok) {
		throw new Error(`Helix chat/emotes: ${response.statusCode}`);
	}
	return response.body.data;
};

/** Titel und Kategorie eines Channels (Helix channels); null, wenn es ihn nicht gibt */
const fetchChannelInfo = async (broadcasterId) => {
	const response = await got('Helix')({
		url: 'channels',
		searchParams: { broadcaster_id: broadcasterId },
	});
	const data = response.ok ? response.body.data[0] : undefined;
	return data ? { title: data.title ?? '', game: data.game_name || null } : null;
};

/** Archiv-VODs eines Users, neueste zuerst */
const fetchArchiveVideos = async (userId, first) => {
	const response = await got('Helix')({
		url: 'videos',
		searchParams: { user_id: userId, type: 'archive', first },
	});
	if (!response.ok) {
		throw new Error(`Helix videos: ${response.statusCode}`);
	}
	return response.body.data;
};

module.exports = { fetchClips, createClip, fetchChannelEmotes, fetchChannelInfo, fetchArchiveVideos };
