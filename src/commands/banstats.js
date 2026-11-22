/** Ban-Log-Ueberblick: Gesamt, nach Status, Top-Channels (aus sb-v2) - nur Bans dieses Bots */
const command = {
	name: 'banstats',
	cooldown: { user: 3 },
	access: { channel: 2 },
	description: 'Ban log summary: total, breakdown by status, top channels.',
	usage: 'banstats',
	execute: async ({ client, message: msg }) => {
		const selfName = bot.Twitch.selfName;
		// Mod_Name verglich MariaDB ohne Gross-/Kleinschreibung
		const match = { type: 'ban', modName: new RegExp(`^${bot.Utils.escapeRegExp(selfName)}$`, 'i') };
		const groupBy = (field, limit) => [
			{ $match: match },
			{ $group: { _id: `$${field}`, Count: { $sum: 1 } } },
			{ $sort: { Count: -1 } },
			...(limit ? [{ $limit: limit }] : []),
			{ $project: { _id: 0, Label: '$_id', Count: 1 } },
		];

		const [total, byStatus, byChannel] = await Promise.all([
			bot.DB.ModerationBanLog.countDocuments(match),
			bot.DB.ModerationBanLog.aggregate(groupBy('status')),
			bot.DB.ModerationBanLog.aggregate(groupBy('channelName', 5)),
		]);

		const statusParts = byStatus.map((i) => `${i.Label || 'unknown'}: ${i.Count}`).join(', ');
		const channelParts = byChannel.map((i) => `#${i.Label}: ${i.Count}`).join(', ');
		return `@${msg.displayName}, Ban stats · Total: ${total ?? 0} · ${statusParts} · Top channels: ${channelParts}`;
	},
};

module.exports = { command };
