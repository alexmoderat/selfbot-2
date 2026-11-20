const { streamData } = require('../util/stream-tracking.js');
const { parseMonthYear } = require('../misc/stream-hours.js');
const { fmtDate } = require('../misc/streamer-streak.js');

/**
 * Einzelne Streams neben den Streamtagen (ninou2, 03.11.2026: "!howmanystream", "!hms 2026", "has streamed 300 times in 275
 * different days in 2026"). Die Tage reichen weit zurueck, einzelne Streams erst bis zur aeltesten bekannten Teilmenge; fuer das
 * angebrochene Jahr steht das dabei (ninou2, 03.11.2026: "on the year 2026 data only exist for these months").
 */
const ALL_WORDS = new Set(['all', 'alltime', 'total']);

module.exports = {
	name: 'howmanystream',
	aliases: ['hms'],
	cooldown: 3000,
	description:
		'How many single streams and different days a channel streamed. No argument = current year. Takes a year ("2026"), month+year ("october2026") or "all". Single streams only count since they started being tracked. Defaults to the current channel.',
	usage: 'howmanystream [channel] [year | month<year> | all]',
	execute: async (client, msg) => {
		const args = [...msg.args];
		const display = msg.displayName;
		let channelRaw;
		let prefix = String(new Date().getUTCFullYear());
		let label = `in ${prefix}`;
		for (const raw of args) {
			const low = raw.toLowerCase();
			const month = parseMonthYear(low);
			if (ALL_WORDS.has(low)) {
				prefix = '';
				label = 'all-time';
			} else if (month) {
				prefix = `${month.year}-${String(month.month).padStart(2, '0')}`;
				label = `in ${month.label}`;
			} else if (/^\d{4}$/.test(low)) {
				prefix = low;
				label = `in ${low}`;
			} else {
				channelRaw ??= raw;
			}
		}

		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const [days, streams] = await Promise.all([streamData.getDays(userId), streamData.countStreams(userId, prefix)]);
		const dayCount = days.filter((i) => i.startsWith(prefix)).length;
		const head = `@${display}, ${label}, ${channel} streamed on [${dayCount}] different days`;
		if (!streams.first) {
			return { text: `${head}, no single streams tracked yet.` };
		}

		const firstDay = streams.first.slice(0, 10);
		if (prefix && firstDay.slice(0, prefix.length) > prefix) {
			return { text: `${head}, single stream data only exists since ${fmtDate(firstDay)}.` };
		}

		const note = !prefix || firstDay.startsWith(prefix) ? ` (data only exists since ${fmtDate(firstDay)})` : '';
		return { text: `${head}, single streams: [${streams.count}]${note}.` };
	},
};
