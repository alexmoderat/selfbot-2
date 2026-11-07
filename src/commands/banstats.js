/** Ban-Log-Ueberblick: Gesamt, nach Status, Top-Channels (aus sb-v2) - nur Bans dieses Bots */
module.exports = {
	name: 'banstats',
	cooldown: 3000,
	description: 'Ban log summary: total, breakdown by status, top channels.',
	usage: 'banstats',
	flags: ['mod'],
	execute: async (client, msg) => {
		const selfName = bot.Twitch.selfName;
		const base = (rs) => rs.from('selfbot_data', 'Moderation_Ban_Log').where('Type = %s', 'ban').where('Mod_Name = %s', selfName);

		const [total, byStatus, byChannel] = await Promise.all([
			core.Query.getRecordset((rs) => base(rs).select('COUNT(*) AS Count').single().flat('Count')), // TODO(port)
			core.Query.getRecordset((rs) => base(rs).select('Status AS Label', 'COUNT(*) AS Count').groupBy('Status').orderBy('Count DESC')), // TODO(port)
			core.Query.getRecordset((rs) =>
				base(rs).select('Channel_Name AS Label', 'COUNT(*) AS Count').groupBy('Channel_Name').orderBy('Count DESC').limit(5),
			), // TODO(port)
		]);

		const statusParts = byStatus.map((i) => `${i.Label || 'unknown'}: ${i.Count}`).join(', ');
		const channelParts = byChannel.map((i) => `#${i.Label}: ${i.Count}`).join(', ');
		return {
			text: `@${msg.displayName}, Ban stats · Total: ${total ?? 0} · ${statusParts} · Top channels: ${channelParts}`,
		};
	},
};
