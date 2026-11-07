const { defineCron } = require('../clients/modules/timers.js');
const { getCurrentCategory } = require('../services/channel-stats.js');
const { streamData } = require('../services/stream-tracking.js');
const { MIN_STREAM_SECONDS } = require('../misc/streamer-streak.js');

/**
 * Zeichnet alle 5 Minuten auf, welche Channels live sind, aus sb-v2s crons/streamer-streak (ninou2, 29.09.2026:
 * "track streamers streak streaming"; alexmoderat: "es soll ab jetzt zählen"). Pro Live-Channel:
 *  - Streaming-Tag (!streamerstreak, !daysstreamed), Start/zuletzt-live (!lastlive)
 *  - 5 Minuten Live-Sekunden (!hoursstreamed) - ein Tick statt Start/Ende-Buchhaltung, ueberlebt Neustarts
 *  - dieselben Sekunden nach Kategorie (!hoursstreamedcategories)
 * Neben den eigenen Channels die Extra-Liste (!streaktrack): "Get Streams" braucht nur die Broadcaster-ID, kein
 * Join/Mod, alles in denselben 100er-Batch. Kategorie aus derselben Antwort (sb-v2 nahm stream-status' Stand und
 * hatte fuer Extra-Channels deshalb immer "no category"); Rueckfall auf den Stand aus stream-status.
 */
const CHECK_EVERY = 5 * 60;

/**
 * Was ein Tick fuer einen Live-Stream bucht: null = noch unter 5 Minuten, nichts schreiben. Beim ersten gezaehlten
 * Tick wurde der vorige (unter 5 Minuten) uebersprungen - dessen Sekunden und ggf. dessen UTC-Tag (Stream ueber
 * 00:00 UTC) werden nachgeholt, damit fuer echte Streams nichts verloren geht.
 */
const planStreamTick = (startedAtIso, now) => {
	const elapsed = Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 1000);
	if (!Number.isFinite(elapsed) || elapsed < MIN_STREAM_SECONDS) {
		return null;
	}

	const today = now.toISOString().slice(0, 10);
	if (elapsed >= MIN_STREAM_SECONDS + CHECK_EVERY) {
		return { seconds: CHECK_EVERY, days: [today] };
	}

	const skippedDay = new Date(now.getTime() - CHECK_EVERY * 1000).toISOString().slice(0, 10);
	const days = skippedDay !== today ? [skippedDay, today] : [today];
	return { seconds: elapsed, days };
};

module.exports = defineCron({
	name: 'streamer-streak',
	expression: '45 */5 * * * *',
	description: 'Records which channels are live each day (for streamerstreak, hoursstreamed, lastlive).',
	code: async function streamerStreak() {
		const platform = bot.Twitch;
		const joined = bot.Channels.getJoinable();

		const idToName = new Map();
		for (const channel of joined) {
			if (channel.twitchId) {
				idToName.set(channel.twitchId, channel.name);
			}
		}

		const extra = await streamData.listExtraChannels().catch((e) => {
			console.warn('[streamer-streak] Extra-Liste nicht ladbar', e);
			return [];
		});
		for (const entry of extra) {
			idToName.set(entry.userId, entry.channel);
		}

		if (idToName.size === 0) {
			return;
		}

		const live = await streamData.fetchLiveStreams([...idToName.keys()]);
		for (const [id, stream] of live) {
			const name = idToName.get(id);
			if (!name) {
				continue;
			}

			const plan = planStreamTick(stream.startedAt, new Date());
			if (!plan) {
				continue;
			}

			try {
				for (const day of plan.days) {
					await streamData.recordLiveToday(id, name, day);
				}
				// ninou2, 02.10.2026: "give the correct hour using UTC"
				await streamData.recordStreamStart(id, name, stream.startedAt);
				await streamData.logStream(id, name, stream.startedAt);
				await streamData.addSeconds(id, name, plan.seconds);

				const channel = joined.find((i) => i.twitchId === id);
				const category = stream.game ?? (channel ? await getCurrentCategory(channel).catch(() => null) : null) ?? 'no category';
				await streamData.addCategorySeconds(id, name, category, plan.seconds);
			} catch (e) {
				console.warn(`[streamer-streak] Aufzeichnung fehlgeschlagen fuer #${name}`, e);
			}
		}
	},
});

Object.assign(module.exports, { planStreamTick });
