const { streamData } = require('../services/stream-tracking.js');

/**
 * Kategorie-Aufschluesselung des letzten VODs (GQL, VIDEO_CHAPTER_MARKERS - kein Helix-Gegenstueck), aus sb-v2
 * (alexmoderat, 17.09.2026: "wie es bei xqc ist ... das gibt doch twitch her")
 */
const fmtGameDuration = (ms) => {
	const totalSeconds = Math.round(ms / 1000);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m ${totalSeconds % 60}s`;
};

module.exports = {
	name: 'gamesplayed',
	cooldown: 3000,
	description: 'Shows the category breakdown of the last VOD (time per game played).',
	usage: 'gamesplayed [channel]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [channelArg] = msg.args;
		const display = msg.displayName;
		const target = (channelArg?.replace(/^[@#]+/, '') || msg.channelData?.name || '').toLowerCase();

		let vods;
		try {
			vods = await streamData.fetchRecentVods(target, 1);
		} catch {
			return { text: `@${display}, failed to fetch VODs for ${target}.` };
		}

		const vod = vods.at(0);
		if (!vod) {
			return { text: `@${display}, no VODs found for ${target}.` };
		}

		let moments;
		try {
			moments = await streamData.fetchVodMoments(vod.id);
		} catch {
			return { text: `@${display}, failed to fetch categories for ${target}'s last VOD.` };
		}

		// Keine Kapitel -> nie die Kategorie gewechselt, die ganze Laenge ist eine Kategorie
		const parts =
			moments.length > 0
				? moments.map((i) => `${i.game} (${fmtGameDuration(i.durationMs)})`)
				: [`${vod.game ?? 'Unknown'} (${fmtGameDuration((vod.lengthSeconds || 0) * 1000)})`];
		const date = new Date(vod.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
		return { text: `@${display}, [${date}]: ${parts.join(', ')}` };
	},
};

Object.assign(module.exports, { fmtGameDuration });
