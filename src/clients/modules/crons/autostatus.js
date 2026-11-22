const { Logger } = require('../../../misc/logger.js');
const { defineCron } = require('../timers.js');

const { pubsub } = require('../../../util/pubsub.js');

/**
 * Postet alle 8 h einen Status-Text in Channels mit !autostatus on, aus sb-v2. Jeder Channel fuehrt seinen eigenen
 * naechsten Termin (Channel_Data autostatusNext), damit "autostatus delay" nur einen Channel verschiebt - der Cron
 * selbst tickt alle 5 Minuten.
 */
const POST_INTERVAL = 8 * 60 * 60 * 1000;
const BOT_START = Date.now();

const formatUptime = (ms) => {
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const parts = [];
	if (d) {
		parts.push(`${d}d`);
	}
	if (h || d) {
		parts.push(`${h}h`);
	}
	parts.push(`${m}m`, `${s % 60}s`);
	return parts.join(' ');
};

/**
 * Naechster Termin: vom geplanten aus weiterzaehlen, sonst summiert sich die 5-min-Granularitaet ueber Tage
 * (ninou2: "3-5min pro Tag", 20.08.2026); nur nach einer ganzen verpassten Periode ab jetzt (kein Nachholen in Serie)
 */
const nextDue = (now, dueAt, interval) => (now - dueAt > interval ? now + interval : dueAt + interval);

module.exports = defineCron({
	name: 'autostatus',
	expression: '0 */5 * * * *',
	description: 'Posts a bot status text every 8h (individually per channel) in channels with autostatus on.',
	code: async function autostatus() {
		const platform = bot.Twitch;
		const channels = bot.Channels.getJoinable();
		const now = Date.now();

		const due = [];
		for (const channel of channels) {
			if ((await bot.Channels.getData(channel, 'autostatus')) !== true) {
				continue;
			}

			// Frisch eingeschaltet: erst einplanen, nicht sofort posten ("next post within 8h")
			const dueAt = await bot.Channels.getData(channel, 'autostatusNext');
			if (typeof dueAt !== 'number') {
				await bot.Channels.setData(channel, 'autostatusNext', now + POST_INTERVAL);
				continue;
			} else if (now >= dueAt) {
				due.push({ channel, dueAt });
			}
		}

		if (due.length === 0) {
			return;
		}

		let live = 0;
		for (const channel of channels) {
			if (await bot.Channels.isLive(channel)) {
				live++;
			}
		}

		const memory = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
		// "joined" statt "channels" (sb-v2, 01.09.2026): aktive Channels inkl. des eigenen, nicht die Mod-Channel-Zahl
		const status = `🤖 uptime: ${formatUptime(now - BOT_START)} | memory: ${memory}MiB | joined: ${channels.length} (${live} live) | irc: ${bot.Client.connections.length} | ps: ${pubsub.status().connections}`;
		for (const { channel, dueAt } of due) {
			await bot.Channels.send(channel, status).catch((e) => Logger.warn(`[autostatus] #${channel.name}`, e));
			await bot.Channels.setData(channel, 'autostatusNext', nextDue(now, dueAt, POST_INTERVAL));
		}
	},
});

Object.assign(module.exports, { formatUptime, nextDue });
