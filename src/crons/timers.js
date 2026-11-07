const { commands } = require('../clients/modules/commands.js');
const { defineCron } = require('../clients/modules/timers.js');
const timers = require('../services/timers.js');
const { isTimerDue } = require('../misc/timers.js');

/**
 * Sendet faellige Timer (commands/timer, alexmoderat 31.10.2026). Tickt jede Minute; Live-Status nur fuer Channels
 * mit Online-Timern abfragen, und pro Channel nur einmal.
 */
module.exports = defineCron({
	name: 'timers',
	expression: '15 * * * * *',
	description: 'Posts the per-channel timer messages when they are due.',
	code: async function sendTimers() {
		const enabled = await timers.listEnabled();
		if (enabled.length === 0) {
			return;
		}

		const now = Date.now();
		const liveCache = new Map();
		for (const timer of enabled) {
			const channel = bot.Channels.get(timer.Channel);
			if (!channel?.writable) {
				continue;
			}

			let live = null;
			if (timer.Online_Only) {
				if (!liveCache.has(channel.id)) {
					liveCache.set(channel.id, await bot.Channels.isLive(channel).catch(() => null));
				}
				live = liveCache.get(channel.id) ?? null;
			}

			if (!isTimerDue(timer, live, now)) {
				continue;
			}

			// Erst markieren, dann senden: ein Sendefehler soll nicht jede Minute neu feuern
			await timers.markSent(timer);
			await bot.Channels.send(channel, timer.Message).catch((e) => console.warn(`[timers] #${channel.name} #${timer.ID}`, e));
		}
	},
});
