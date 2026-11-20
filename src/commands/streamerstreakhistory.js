const { streamData } = require('../util/stream-tracking.js');
const { fmtDate, tiesNote, yearlyBreakdown } = require('../misc/streamer-streak.js');

/**
 * X/365 fuer jedes Jahr mit Daten samt laengstem Streak, aus sb-v2 (ninou2, 29.09.2026). Kein "so far" - "when its in
 * the past, its already done". Am Ende der Tracking-Start dieses Channels (ninou2, 30.09.2026, "——" als Trenner).
 */
module.exports = {
	name: 'streamerstreakhistory',
	aliases: ['streakhistory', 'ssh'],
	cooldown: 3000,
	description: 'Yearly streaming-day breakdown (X/365) for a channel, for every year with recorded data. Defaults to the current channel.',
	usage: 'streamerstreakhistory [channel]',
	execute: async (client, msg) => {
		const [targetRaw] = msg.args;
		const display = msg.displayName;
		const channel = (targetRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const own = channel === msg.channelData?.name;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const days = await streamData.getDays(userId);
		if (days.length === 0) {
			return {
				text: `@${display}, no stream days recorded yet for ${own ? 'this channel' : `#${channel}`} — either tracking just started, or that's not a channel I watch.`,
			};
		}

		const years = yearlyBreakdown(days)
			.map(
				({ year, count, total, longestStreak, longestStart, longestEnd, longestTies }) =>
					`${year}: ${count}/${total} [ their LONGEST streak was ${longestStreak} , Recorded from ${fmtDate(longestStart)} to ${fmtDate(longestEnd)}${tiesNote(longestTies)} ]`,
			)
			.join(', ');

		return { text: `@${display}, ${channel}'s yearly stream streak history — ${years} —— tracking for this channel started on ${fmtDate(days[0])}` };
	},
};
