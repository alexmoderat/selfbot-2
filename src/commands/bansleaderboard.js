const { uploadToHaste } = require('../misc/haste.js');

/** Top-Channels nach Auto-Bans dieses Bots, als Haste-JSON (aus sb-v2) */
module.exports = {
	name: 'bansleaderboard',
	aliases: ['banleaderboard', 'topbans'],
	cooldown: 3000,
	description: 'Top channels by auto-ban count.',
	usage: 'bansleaderboard [top:N, default 25]',
	params: [{ name: 'top', type: 'number' }],
	execute: async (client, msg) => {
		const display = msg.displayName;
		const requested = msg.params.top;
		const limit = requested !== undefined && Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 25;

		const rows = await bot.DB.ModerationBanLog.aggregate([
			{ $match: { automated: true, modName: new RegExp(`^${bot.Utils.escapeRegExp(bot.Twitch.selfName)}$`, 'i') } },
			{ $group: { _id: '$channelName', Count: { $sum: 1 } } },
			{ $sort: { Count: -1 } },
			{ $limit: limit },
			{ $project: { _id: 0, Channel_Name: '$_id', Count: 1 } },
		]);

		if (rows.length === 0) {
			return { text: `@${display}, No auto-bans recorded yet.` };
		}

		const json = rows.map((i, index) => ({ rank: index + 1, channel: i.Channel_Name, bans: Number(i.Count) }));
		const url = await uploadToHaste(JSON.stringify(json, null, 2));
		return { text: `@${display}, Top ${rows.length} channels by auto-bans: ${url}` };
	},
};
