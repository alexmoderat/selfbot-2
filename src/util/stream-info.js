const { got } = require('../token/got.js');
const { fetchTwitchUser } = require('./twitch/twitch-utils.js');
const { GQL_PUBLIC_CLIENT_ID, getLastBroadcastStart } = require('../token/gql.js');
const { fetchArchiveVideos, fetchChannelInfo, fetchClips } = require('../token/twitch-info.js');

// Stream-Infos fuer si/streaminfo/uptime, aus sb-v2s v2/utils/stream-info.ts

const PLAYBACK_QUERY_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712';

/** Wie sb-v2: ab einem Monat ohne Stunden/Minuten */
const formatStreamDuration = (ms) => {
	const totalMin = Math.floor(ms / 60000);
	const totalH = Math.floor(totalMin / 60);
	const totalD = Math.floor(totalH / 24);
	const mo = Math.floor(totalD / 30);
	const y = Math.floor(mo / 12);

	const parts = [];
	if (y > 0) parts.push(`${y}y`);
	if (mo % 12 > 0) parts.push(`${mo % 12}mo`);
	if (totalD % 30 > 0) parts.push(`${totalD % 30}d`);
	if (!y && !mo && totalH % 24 > 0) parts.push(`${totalH % 24}h`);
	if (!y && !mo && totalMin % 60 > 0) parts.push(`${totalMin % 60}m`);
	return parts.join(' ') || '0m';
};

/** SOURCE-Zeile einer m3u8-Masterplaylist (chunked bevorzugt) -> Bitrate/Aufloesung/FPS */
const parseSourceQuality = (m3u8) => {
	let sourceLine = null;
	for (const line of m3u8.split('\n')) {
		if (!line.startsWith('#EXT-X-STREAM-INF')) {
			continue;
		}
		if (line.includes('chunked') || !sourceLine) {
			sourceLine = line;
		}
		if (line.includes('chunked') || line.toLowerCase().includes('source')) {
			break;
		}
	}
	if (!sourceLine) {
		return null;
	}

	const bw = sourceLine.match(/BANDWIDTH=(\d+)/);
	const res = sourceLine.match(/RESOLUTION=(\d+x\d+)/);
	const fps = sourceLine.match(/FRAME-RATE=([\d.]+)/);
	return {
		bitrate: bw ? Math.round(Number.parseInt(bw[1], 10) / 1000) : null,
		resolution: res ? res[1] : null,
		fps: fps ? Math.round(Number.parseFloat(fps[1])) : null,
	};
};

/** Bitrate/FPS/Aufloesung des Source-Streams: Playback-Token per GQL, dann die Masterplaylist bei usher */
const fetchHlsQuality = async (login) => {
	try {
		const tokenResponse = await got('Global')({
			method: 'POST',
			url: 'https://gql.twitch.tv/gql',
			headers: { 'Client-Id': GQL_PUBLIC_CLIENT_ID },
			json: {
				operationName: 'PlaybackAccessToken',
				variables: { isLive: true, login, isVod: false, vodID: '', playerType: 'site' },
				extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_QUERY_HASH } },
			},
			timeout: { request: 5000 },
		});

		const token = tokenResponse.body.data?.streamPlaybackAccessToken;
		if (!token?.value) {
			return null;
		}

		const playlist = await got('Global')({
			url: `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8`,
			searchParams: { sig: token.signature, token: token.value, allow_source: 'true', fast_bread: 'true' },
			responseType: 'text',
			timeout: { request: 5000 },
		});

		return playlist.ok ? parseSourceQuality(String(playlist.body)) : null;
	} catch (e) {
		console.warn('[stream-info] HLS-Abruf fehlgeschlagen', e);
		return null;
	}
};

/** VOD-Dauer wie "3h16m42s" in Sekunden */
const parseVodDuration = (dur) => {
	const m = (dur || '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
	return Number(m?.[1] ?? 0) * 3600 + Number(m?.[2] ?? 0) * 60 + Number(m?.[3] ?? 0);
};

/** null = User existiert nicht */
const getStreamInfo = async (login) => {
	const user = await fetchTwitchUser(login);
	if (!user) {
		return null;
	}

	const streamResponse = await got('Helix')({
		url: 'streams',
		searchParams: { user_id: user.id },
	});
	if (!streamResponse.ok) {
		throw new Error(`Helix streams: ${streamResponse.statusCode}`);
	}

	const stream = streamResponse.body.data[0];
	if (stream) {
		const since = new Date(Date.now() - 86_400_000).toISOString();
		const [clips, hls] = await Promise.all([fetchClips(user.id, 100, { started_at: since }).catch(() => []), fetchHlsQuality(login)]);

		return {
			live: true,
			displayName: user.display_name,
			viewers: stream.viewer_count.toLocaleString('en-US'),
			gameName: stream.game_name || 'Unknown',
			uptime: formatStreamDuration(Date.now() - new Date(stream.started_at).getTime()),
			title: stream.title || '',
			clipCount: clips.length,
			thumb: (stream.thumbnail_url || '').replace('{width}', '1280').replace('{height}', '720'),
			hls,
		};
	}

	// Offline: letzte Kategorie + wie lange offline
	const lastGame = (await fetchChannelInfo(user.id).catch(() => null))?.game || 'Unknown';
	const vod = (await fetchArchiveVideos(user.id, 1).catch(() => []))[0];

	let offlineSince = '';
	let lastTitle = '';
	if (vod) {
		const endTime = new Date(vod.created_at).getTime() + parseVodDuration(vod.duration) * 1000;
		offlineSince = formatStreamDuration(Date.now() - endTime);
		lastTitle = vod.title || '';
	}

	// Ohne gespeicherte VODs bleibt nur der Start der letzten Uebertragung (sb-v2: IVR lastBroadcast, gleiche GQL-Quelle)
	if (!offlineSince) {
		const startedAt = await getLastBroadcastStart(login).catch(() => null);
		if (startedAt) {
			offlineSince = formatStreamDuration(Date.now() - new Date(startedAt).getTime());
		}
	}

	return { live: false, displayName: user.display_name, lastGame, offlineSince, lastTitle };
};

module.exports = { formatStreamDuration, parseSourceQuality, fetchHlsQuality, parseVodDuration, getStreamInfo };
