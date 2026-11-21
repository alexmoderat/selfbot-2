const { Logger } = require('../../../misc/logger.js');
const { commands } = require('../commands.js');
const { defineCron } = require('../timers.js');
const timers = require('../../../util/timers.js');
const { isTimerDue, withGroupLastSent } = require('../../../util/timer-rules.js');

/**
 * Sendet faellige Timer (commands/timer, alexmoderat 31.10.2026). Tickt jede Minute; Live-Status nur fuer Channels
 * mit Online-/Offline-Timern abfragen, und pro Channel nur einmal.
 */
// isLive ist synchron (true/false/null) - ein ".catch" darauf warf bei jedem Live-/Offline-Timer einen Fehler
const liveOf = (channel) => {
	try {
		return bot.Channels.isLive(channel) ?? null;
	} catch {
		return null;
	}
};

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
			// Channels sind seit der MongoDB-Umstellung (07.11.2026) einfache Objekte ohne "writable" - die Abfrage darauf hat
			// seitdem jeden Timer still uebersprungen (ninou2, 19.11.2026: "didnt post the +Ed")
			if (!channel || !bot.Channels.isWritable(channel)) {
				continue;
			}

			let live = null;
			if (timer.Online_Only || timer.Offline_Only) {
				if (!liveCache.has(channel.id)) {
					liveCache.set(channel.id, liveOf(channel));
				}
				live = liveCache.get(channel.id) ?? null;
			}

			// whenlive: Live-Status des anderen Channels (unbekannter/entfernter Channel = nicht live)
			let otherLive = null;
			if (timer.Live_Channel) {
				const other = bot.Channels.get(Number(timer.Live_Channel));
				if (other) {
					if (!liveCache.has(other.id)) {
						liveCache.set(other.id, liveOf(other));
					}
					otherLive = liveCache.get(other.id) ?? null;
				}
			}

			// Sync-Gruppe: Intervall ab dem letzten Senden irgendeines Timers der Gruppe
			if (!isTimerDue(withGroupLastSent(timer, enabled), live, now, otherLive)) {
				continue;
			}

			// Erst markieren, dann senden: ein Sendefehler soll nicht jede Minute neu feuern; Last_Sent auch hier im Speicher
			// setzen, damit ein zweiter Timer derselben Gruppe im selben Durchlauf nicht ebenfalls sendet
			await timers.markSent(timer);
			timer.Last_Sent = now;
			await bot.Channels.send(channel, timer.Message).catch((e) => Logger.warn(`[timers] #${channel.name} #${timer.ID}`, e));
		}
	},
});
