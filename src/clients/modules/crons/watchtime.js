const { Logger } = require('../../../misc/logger.js');
const { setTimeout: sleep } = require('node:timers/promises');
const { defineCron } = require('../timers.js');
const { addWatchtime, isKnownBot } = require('../../../util/channel-stats.js');
const { fetchChatters } = require('../../../token/twitch-lists.js');

/**
 * Schreibt allen Chattern alle 5 Minuten Watchtime gut (live) bzw. Offline-Chat-Zeit (offline), aus sb-v2.
 * Quelle: Helix-Chatterliste (nur wo der Bot moddet), Bots (known_bots + TwitchInsights) zaehlen nicht.
 */
const MINUTES_PER_TICK = 5;
const CHANNEL_DELAY = 300; // Rate-Limit schonen

module.exports = defineCron({
	name: 'watchtime',
	expression: '0 */5 * * * *',
	description: 'Credits all chatters with 5 minutes of watchtime (or offline chat time) every 5 minutes.',
	code: async function watchtime() {
		const platform = bot.Twitch;
		for (const channel of bot.Channels.getJoinable()) {
			if (!channel.twitchId) {
				continue;
			}

			try {
				const result = await fetchChatters(channel.twitchId, platform.selfId);
				if (result.forbidden || result.users.length === 0) {
					continue;
				}

				const ids = [];
				for (const user of result.users) {
					if (!(await isKnownBot(user.login))) {
						ids.push({ id: user.id, login: user.login.toLowerCase() });
					}
				}

				const live = (await bot.Channels.isLive(channel)) === true;
				await addWatchtime(channel, ids, MINUTES_PER_TICK, live);
			} catch (e) {
				Logger.warn(`[watchtime] Fehler in #${channel.name}`, e);
			}

			await sleep(CHANNEL_DELAY);
		}
	},
});
