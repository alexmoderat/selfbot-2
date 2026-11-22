const { execSync } = require('node:child_process');
const { uptime: systemUptime } = require('node:os');
const path = require('node:path');

const BOT_START = Date.now();

const formatUptime = (ms) => {
	const s = Math.floor(ms / 1000);
	const mo = Math.floor(s / 2_592_000); // 30 Tage
	const d = Math.floor((s % 2_592_000) / 86_400);
	const h = Math.floor((s % 86_400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;

	const parts = [];
	if (mo) parts.push(`${mo}mo`);
	if (d || mo) parts.push(`${d}d`);
	if (h || d || mo) parts.push(`${h}h`);
	parts.push(`${m}m`, `${sec}s`);
	return parts.join(' ');
};

let commit = null;
const getCommit = () => {
	if (commit === null) {
		try {
			commit = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..', '..') })
				.toString()
				.trim();
		} catch {
			commit = 'unknown';
		}
	}
	return commit;
};

/** Latenz zu Twitch: IRC-PING ueber dank-twitch-irc */
const getTwitchLatency = async (client) => {
	try {
		const start = process.hrtime.bigint();
		await client.ping();
		return Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
	} catch {
		return null;
	}
};

// Format aus sb-v2 (Ausnahme von "Supibot zuerst")
module.exports = {
	name: 'ping',
	aliases: ['pong'],
	cooldown: 3000,
	description: 'Shows bot and server uptime, memory usage, channel count, joiner channels, IRC and PubSub connections and commit.',
	usage: 'ping',
	flags: ['pipe', 'skip-banphrase'],
	execute: async (client, msg) => {
		const latency = msg.debug ? null : await getTwitchLatency(client);
		const memory = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
		// Wie potatbotat: offene IRC- und PubSub-Verbindungen
		const pubsub = bot.PubSub?.status();
		// Joiner (services/random-joiner.js): zufaellig mitgelesene fremde Channels, nicht in bot.Channels
		const joiner = bot.Joiner?.status();

		const parts = [
			`uptime: ${formatUptime(Date.now() - BOT_START)}`,
			`server uptime: ${formatUptime(systemUptime() * 1000)}`,
			latency !== null ? `twitch latency: ${latency}ms` : null,
			`memory: ${memory}MiB`,
			`channels: ${bot.Channels.getJoinable().length}`,
			joiner ? `joiner: ${joiner.channels.length}` : null,
			`irc: ${client.connections.length}`,
			pubsub ? `ps: ${pubsub.connections}` : null,
			`commit: ${getCommit()}`,
			`node: ${process.version}`,
		].filter(Boolean);

		return { text: `AlienDance 🏓 @${msg.displayName}, ${parts.join(' · ')}` };
	},
};
