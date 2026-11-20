const { fetchChatters } = require('../token/twitch-lists.js');
const { USERNAME_EVADER_PATTERNS } = require('./username-evader.js');

// Ersatz fuer IRC-JOIN ("userJoin"), aus sb-v2s v2/singletons/join-poller.ts: Twitch liefert Viewer-Joins
// nur ueber IRC - die Chatterliste (Helix chat/chatters) ist der naechste Ersatz. Alle paar Sekunden abfragen,
// neue Logins gegen den letzten Stand vergleichen und je neuem Login ein "userJoin" ausloesen.
// Unterschiede zu IRC: bis zu POLL_INTERVAL verzoegert, ein kurzer Ein-/Ausstieg dazwischen wird nicht gesehen.
// Channels: newAccountFollowersGuard an, oder feste Username-Muster (username-evader-ban).
// sb-v2 fiel bei 403 (kein Mod) auf IRC-JOIN zurueck - ohne IRC wird der Channel hier nur einmal gemeldet.

const POLL_INTERVAL = 15_000;

const previous = new Map();
const forbidden = new Set();
let timer = null;

const isWatched = async (channel) => {
	if (channel.mode === 'Inactive' || !channel.twitchId) {
		return false;
	} else if (USERNAME_EVADER_PATTERNS[channel.name]) {
		return true;
	}

	return (await bot.Channels.getData(channel, 'newAccountFollowersGuard')) === true;
};

const pollChannel = async (platform, channel) => {
	const result = await fetchChatters(channel.twitchId, platform.selfId);
	if (result.forbidden) {
		if (!forbidden.has(channel.id)) {
			forbidden.add(channel.id);
			console.warn(`[join-poller] #${channel.name}: Chatterliste nicht erlaubt (403) - keine userJoin-Ereignisse`);
		}
		return;
	}

	forbidden.delete(channel.id);
	const now = new Set(result.names.map((i) => i.toLowerCase()));
	const before = previous.get(channel.id);
	previous.set(channel.id, now);
	if (!before) {
		return; // erster Stand nach dem Start: nur merken
	}

	const self = platform.selfName.toLowerCase();
	for (const login of now) {
		if (before.has(login) || login === self || login === channel.name) {
			continue;
		}

		if (process.env.JOIN_LOG === '1') {
			console.log(`[join-poller] userJoin #${channel.name}: ${login}`);
		}

		bot.ChatModules.dispatch('userJoin', { platform, channel, userName: login });
	}
};

const tick = async (platform) => {
	for (const channel of bot.Channels.getJoinable()) {
		if (!(await isWatched(channel))) {
			previous.delete(channel.id);
			continue;
		}

		await pollChannel(platform, channel).catch((e) => console.warn(`[join-poller] #${channel.name}`, e));
	}
};

/** Startet die Abfrage (einmalig) */
const start = (platform) => {
	if (timer) {
		return;
	}

	timer = setInterval(() => void tick(platform), POLL_INTERVAL);
	timer.unref();
	console.log(`[join-poller] aktiv (alle ${POLL_INTERVAL / 1000} s, Channels mit Username-Mustern + newAccountFollowersGuard)`);
};

const stop = () => {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
};

module.exports = { start, stop };
