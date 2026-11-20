// Live-Chatter-Suche fuer /v1/live-chatters, aus sb-v2s v2/utils/live-chatters.ts (rein, Abhaengigkeiten werden uebergeben)
/**
 * "Live-Chatter-Kandidaten" (Vorbild: CatQuerys /admin/live-chatter-candidates): wer von den
 * letzten Chattern eines Channels streamt gerade selbst? Die Datenquellen werden uebergeben,
 * damit die Logik ohne Datenbank und Netz testbar ist.
 */

const MAX_RESOLVE = 200;
const MAX_MONITORED_LOOKUPS = 40;
const CONCURRENCY = 5;

async function pool(items, size, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		}),
	);
	return out;
}

async function findLiveChatters(deps, channel, opts = {}) {
	const minutes = opts.minutes ?? 60;
	const ch = channel.replace(/^#+/, '').toLowerCase();
	const { chatters, messages } = await deps.recentChatters(ch, minutes);
	// der Channel selbst ist trivial "live" und kein Kandidat
	const others = chatters.filter((c) => c.username.toLowerCase() !== ch);

	const ids = new Map();
	const missing = [];
	for (const c of others) c.userId ? ids.set(c.userId, c) : missing.push(c);
	if (missing.length) {
		const resolved = await deps.resolveIds(missing.slice(0, MAX_RESOLVE).map((c) => c.username));
		for (const c of missing) {
			const id = resolved[c.username.toLowerCase()];
			if (id) ids.set(id, { ...c, userId: id });
		}
	}

	const streams = ids.size ? await deps.liveStreams([...ids.keys()]) : [];
	const live = streams.filter((s) => ids.has(s.userId));

	// Reihenfolge: aktivste Chatter zuerst; CatQuery nur fuer die ersten MAX_MONITORED_LOOKUPS fragen
	live.sort((a, b) => (ids.get(b.userId)?.count ?? 0) - (ids.get(a.userId)?.count ?? 0));
	const status = await pool(live.slice(0, MAX_MONITORED_LOOKUPS), CONCURRENCY, (s) => deps.monitored(s.login).catch(() => null));

	let candidates = live.map((s, i) => {
		const st = i < status.length ? status[i] : null;
		return {
			userId: s.userId,
			username: s.login,
			channelUrl: `https://www.twitch.tv/${s.login}`,
			messages: ids.get(s.userId)?.count ?? 0,
			game: s.game,
			viewers: s.viewers,
			startedAt: s.startedAt,
			monitored: st ? st.monitored : null,
			reason: st?.reason ?? null,
		};
	});
	if (opts.onlyUnmonitored) candidates = candidates.filter((c) => c.monitored !== true);

	return {
		channel: ch,
		minutes,
		messagesScanned: messages,
		uniqueChatters: chatters.length,
		candidates,
		usernames: candidates.map((c) => c.username).join(','),
	};
}

module.exports = { findLiveChatters };
