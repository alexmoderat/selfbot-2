const { defineChatModule } = require('../chat-modules.js');

/**
 * Wiederholt geteilte Watch-Streaks in #ninou2 mit einem W dahinter (ninou2, 03.11.2026: "repost the same exact
 * share in the chat and maybe add W streak at the end of it"; alexmoderat: nur dort). Seit 11.11.2026 auch in #im_row1
 * (ninou2 teilte dort 130 und "bot didnt post the streak"; alexmoderat: "Ja, auch im_row1"). Der eigene Streak hat
 * watch-streak-progress.
 */
const CHANNELS = new Set(['ninou2', 'im_row1']);

// Dieselbe Meldung kommt per IRC und per CatQuery-Firehose (startup.js) - Vorfall brayanx2, 08.11.2026: doppelt gepostet.
// Daher je Nachrichten-ID (sonst Login+Wert+Channel) nur einmal.
const DEDUPE_WINDOW = 10 * 60_000;
const seen = new Map();

const isDuplicate = (key, now = Date.now()) => {
	for (const [k, at] of seen) {
		if (now - at > DEDUPE_WINDOW) {
			seen.delete(k);
		}
	}
	if (seen.has(key)) {
		return true;
	}
	seen.set(key, now);
	return false;
};

const repostText = (login, value) => `${login} watched ${value} consecutive streams and sparked a watch streak! W @${login} wW streak`;

module.exports = defineChatModule({
	name: 'watch-streak-repost',
	description: 'Reposts shared watch streaks in #ninou2 and #im_row1.',
	scope: 'global',
	handlers: {
		usernotice: async (context) => {
			const { channel, msgId, tags, platform } = context;
			if (msgId !== 'viewermilestone' || tags['msg-param-category'] !== 'watch-streak' || !CHANNELS.has(channel.name)) {
				return;
			}

			const login = String(tags.login ?? '').toLowerCase();
			const value = Number.parseInt(String(tags['msg-param-value'] ?? ''), 10);
			const key = String(tags.id || `${channel.name}:${login}:${value}`);
			if (login && login !== platform.selfName && Number.isFinite(value) && !isDuplicate(key)) {
				await bot.Channels.send(channel, repostText(login, value));
			}
		},
	},
});

Object.assign(module.exports, { repostText, CHANNELS, isDuplicate });
