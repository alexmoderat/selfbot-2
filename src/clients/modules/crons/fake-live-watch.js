const { defineCron } = require('../timers.js');
const { punishFakeLive, hashLiveThumbnail } = require('../chat/follow-protection.js');
const { findHashMatch, listPendingWatches, recordHash, removeExpiredWatches, removeWatch } = require('../../../util/fake-live.js');
const { FAKE_LIVE_MAX_DISTANCE } = require('../../../util/image-hash.js');

/**
 * Tastet neue Live-Follower, bei denen der Sofort-Check in follow-protection keinen Thumbnail-Hash-Treffer fand, bis
 * zu 1 h lang alle 5 min erneut ab, aus sb-v2. Ein aufgezeichneter Bot-Farm-Loop steht beim ersten Blick oft
 * phasenverschoben zu einem anderen Account (echter Test 30.09.2026: Distanz 22/64) - ueber mehrere Runden landen
 * die Vergleichspunkte nah genug beieinander. Jede Probe wird gegen ALLE bisherigen anderer Channels verglichen.
 */
module.exports = defineCron({
	name: 'fake-live-watch',
	expression: '0 */5 * * * *',
	description: 'Re-samples new live followers for up to 1h to catch phase-shifted bot farm video loops via thumbnail hash.',
	code: async function fakeLiveWatch() {
		await removeExpiredWatches().catch(() => {});
		const pending = await listPendingWatches().catch(() => []);
		const platform = bot.Twitch;

		for (const { Channel_Name: channelName, User_ID: userId } of pending) {
			try {
				const hash = await hashLiveThumbnail(userId);
				if (!hash) {
					continue; // nicht (mehr) live - naechste Runde, bis der Eintrag ablaeuft
				}

				const match = await findHashMatch(channelName, hash, FAKE_LIVE_MAX_DISTANCE).catch(() => null);
				await recordHash(channelName, userId, hash).catch(() => {});
				if (!match) {
					continue;
				}

				const channel = bot.Channels.get(channelName);
				if (channel) {
					await punishFakeLive(platform, channel, userId, userId, match);
				}
				await removeWatch(channelName, userId).catch(() => {});
			} catch (e) {
				console.warn(`[fake-live-watch] Fehler bei ${userId}/#${channelName}`, e);
			}
		}
	},
});
