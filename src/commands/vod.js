const { fetchTwitchUser } = require('../util/twitch/twitch-utils.js');
const { fmtDate } = require('../misc/date-format.js');
const { fetchArchiveVideos } = require('../misc/twitch-info.js');

/**
 * Neuestes VOD eines Streamers, aus sb-v2. Mehrere VODs vom selben UTC-Tag werden alle als #1 #2 ... verlinkt
 * (ninou2, 20.10.2026), Datum nur, wenn der Tag nicht heute ist.
 */
const utcDay = (iso) => iso.slice(0, 10);

/** VODs vom selben Tag wie das neueste, aelteres zuerst (Twitch liefert neueste zuerst) */
const latestDayVods = (vods) => {
	const day = utcDay(vods[0].created_at);
	return { day, vods: vods.filter((i) => utcDay(i.created_at) === day).reverse() };
};

const formatVodReply = (display, streamer, day, vods, today = new Date().toISOString().slice(0, 10)) => {
	const isToday = day === today;
	if (vods.length === 1) {
		return `@${display}, @${streamer} Latest VOD${isToday ? '' : ` (${fmtDate(day)})`} is ${vods[0].url}`;
	}

	// "VOD" ohne s, damit es bei ninou2 als Emote matcht; "soo far" nur, solange der Tag laeuft
	const parts = vods.map((i, index) => `#${index + 1} ${i.url}`).join(' ');
	const countPhrase = isToday ? `${vods.length} vod soo far on this day` : `${vods.length} vod on ${fmtDate(day)}`;
	return `@${display}, @${streamer} Latest VOD (${countPhrase}): ${parts}`;
};

module.exports = {
	name: 'vod',
	aliases: ['vods'],
	cooldown: 3000,
	description: 'Latest VOD of a streamer. Without an argument: current channel.',
	usage: 'vod [streamer]',
	flags: ['no-prefix'],
	execute: async (client, msg) => {
		const [target] = msg.args;
		const display = msg.displayName;
		const login = (target ?? msg.channelData?.name ?? '').toLowerCase().replace('#', '');

		let user;
		let vods;
		try {
			user = login ? await fetchTwitchUser(login) : null;
			vods = user ? await fetchArchiveVideos(user.id, 10) : [];
		} catch {
			return { text: `@${display}, Failed to fetch VOD.` };
		}

		if (!user) {
			return { text: `@${display}, Streamer "${login}" not found.` };
		}
		if (vods.length === 0) {
			return { text: `@${display}, ${user.display_name} has no VODs.` };
		}

		const result = latestDayVods(vods);
		return { text: formatVodReply(display, user.display_name, result.day, result.vods) };
	},
};

Object.assign(module.exports, { latestDayVods, formatVodReply });
