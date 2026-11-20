const { streamData } = require('../util/stream-tracking.js');
const { uploadToOwnHaste } = require('../token/haste.js');
const { formatStreamExport, hasExportData } = require('../util/stream-export.js');

/**
 * Alle gespeicherten Stream-Daten eines Channels als Text-Link (ninou2, 03.11.2026: "!gt xqc", dann "it should be !gd", "not !gt"; "it give
 * a TXT file with all info", "so we [have] it as backup"). Fuer jeden nutzbar. Roh-Ansicht, damit der Link direkt eine
 * Textdatei ist.
 */
module.exports = {
	name: 'getdata',
	aliases: ['gd'],
	cooldown: 30000,
	description:
		"Gives a link to a text file with everything stored about a channel's streams: days, hours, streaks and categories. Defaults to the current channel.",
	usage: 'getdata [channel]',
	execute: async (client, msg) => {
		const [channelRaw] = msg.args;
		const display = msg.displayName;
		const channel = (channelRaw ?? msg.channelData?.name ?? '').replace(/^[@#]+/, '').toLowerCase();
		const where = channel === msg.channelData?.name ? 'this channel' : `#${channel}`;
		const userId = await streamData.fetchUserId(channel);
		if (!userId) {
			return { text: `@${display}, no Twitch account named "${channel}" exists.` };
		}

		const [days, years, categoryAllTime, categoryYearList] = await Promise.all([
			streamData.getDays(userId),
			streamData.getAllYears(userId),
			streamData.getCategoryAllTimeBreakdown(userId),
			streamData.getCategoryYears(userId),
		]);
		if (!hasExportData({ days, years, categoryAllTime })) {
			return { text: `@${display}, nothing stored for ${where} yet — either tracking just started, or that's not a channel I watch.` };
		}

		const sortedYears = years.toSorted((a, b) => a.year - b.year);
		const months = (
			await Promise.all(sortedYears.map(async ({ year }) => (await streamData.getMonthlyBreakdown(userId, year)).map((i) => ({ year, ...i }))))
		).flat();
		const categoryYears = await Promise.all(
			categoryYearList.map(async (year) => ({
				year,
				rows: await streamData.getCategoryYearBreakdown(userId, year),
			})),
		);

		const text = formatStreamExport({
			channel,
			generatedAt: new Date().toISOString(),
			days,
			years: sortedYears,
			months,
			categoryYears,
			categoryAllTime,
		});

		const link = (await uploadToOwnHaste(text).catch(() => null))?.replace(/^(https:\/\/paste\.alexmoderat\.eu)\//, '$1/raw/');
		if (!link) {
			return { text: `@${display}, the upload failed, try again later.` };
		}

		return { text: `@${display}, stream data for @${channel}: ${link}` };
	},
};
