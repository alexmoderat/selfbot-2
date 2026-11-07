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

		const rows = await core.Query.getRecordset((rs) =>
			rs // TODO(port)
				.select('Channel_Name', 'COUNT(*) AS Count')
				.from('selfbot_data', 'Moderation_Ban_Log')
				.where('Automated = %b', true)
				.where('Mod_Name = %s', bot.Twitch.selfName)
				.groupBy('Channel_Name')
				.orderBy('Count DESC')
				.limit(limit),
		);

		if (rows.length === 0) {
			return { text: `@${display}, No auto-bans recorded yet.` };
		}

		const json = rows.map((i, index) => ({ rank: index + 1, channel: i.Channel_Name, bans: Number(i.Count) }));
		const url = await uploadToHaste(JSON.stringify(json, null, 2));
		return { text: `@${display}, Top ${rows.length} channels by auto-bans: ${url}` };
	},
};
