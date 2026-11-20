const { defineCron } = require('../timers.js');
const { callAdmin, configuredChannelIds, readAdminKey, resolveIds } = require('../../../misc/justlog.js');

/**
 * Fuegt neue Bot-Channels automatisch zu justlog hinzu (nie entfernen), aus sb-v2s crons/justlog-sync, alle 6 h.
 * Nur EIN Prozess darf das tun - solange sb-v2 laeuft, per config-Blacklist aus (sb-v2: V2_JUSTLOG_SYNC=1).
 */
const EXCLUDED_CHANNELS = new Set(['okayyfiona']);

module.exports = defineCron({
	name: 'justlog-sync',
	expression: '0 0 */6 * * *',
	description: "Adds new bot channels to justlog's channel list.",
	code: async function justlogSync() {
		const key = readAdminKey();
		const existing = configuredChannelIds();
		if (!key || !existing) {
			console.warn('[justlog-sync] justlog-config nicht lesbar');
			return;
		}

		const platform = bot.Twitch;
		const logins = bot.Channels.getJoinable()
			.map((i) => i.Name)
			.filter((i) => !EXCLUDED_CHANNELS.has(i));
		const ids = await resolveIds(logins).catch(() => []);
		const newIds = ids.filter((i) => !existing.has(i));
		if (newIds.length === 0) {
			return;
		}

		await callAdmin('POST', newIds, key);
		console.log(`[justlog-sync] ${newIds.length} neue Channel(s) zu justlog hinzugefuegt`);
	},
});
