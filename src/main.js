// selfbot-next - alexmoderat's Twitch-Bot, aufgebaut wie DontAddThisBot:
// IRC ueber dank-twitch-irc, MongoDB, globales "bot"-Objekt, src/commands/*.js

const { getConfig } = require('./config.js');
const { Logger, LogLevel } = require('./misc/logger.js');

const config = getConfig();

global.bot = {
	Config: config,
	DB: require('./database/db.js'),
	Redis: require('./database/redis.js').create(config.redis),
	Utils: require('./misc/utility.js'),
	Logger,
	/** Twitch-IDs der gerade live gemeldeten Channels */
	Live: new Set(),
};

const { client, connect } = require('./util/twitch/connections.js');
const { Twitch, send, sendToLogin, whisper, join, part, loadLiveChannels } = require('./clients/twitch.js');
const { startCmds, commands } = require('./clients/modules/commands.js');
const ChatModules = require('./clients/modules/chat-modules.js');

bot.Client = client;
bot.Twitch = { send, sendToLogin, whisper, join, part };
bot.Channels = require('./services/channels.js');
bot.Users = require('./services/users.js');
bot.Filter = require('./services/filter.js');
bot.Banphrase = require('./services/banphrase.js');
bot.AFK = require('./services/afk.js');
bot.Reminders = require('./services/reminders.js');
bot.ChatModules = ChatModules;
bot.Commands = commands;

const start = async () => {
	console.time('[main] Start');
	await bot.DB.connect(config.mongo.uri);

	const counts = {
		channels: await bot.Channels.load(),
		filters: await bot.Filter.load(),
		banphrases: await bot.Banphrase.load(),
		afk: await bot.AFK.load(),
	};
	startCmds(config);
	counts.modules = await ChatModules.load(config);
	// Reminder brauchen Channels (Zeit-Reminder feuern sofort nach dem Laden)
	counts.reminders = await bot.Reminders.load();

	await require('./clients/console.js').start(config.console.port);

	// Event-Handler nur einmal registrieren; nach Reconnects joint dank-twitch-irc die Channels selbst neu
	client.once('ready', async () => {
		Logger.log(LogLevel.SILLY, 'Connected to chat!');
		await Twitch();
	});

	client.on('close', (err) => {
		if (err != null) {
			Logger.log(LogLevel.ERROR, 'Client closed due to error', err);
		}
		process.exit(err ? 1 : 0);
	});

	await connect();

	// Live-Status: beim Start und alle 2 Minuten per Helix (bis PubSub stream-up/-down portiert ist)
	const refreshLive = () => loadLiveChannels().catch((e) => Logger.warn('[twitch] Live-Status nicht ladbar', e.message));
	await refreshLive();
	setInterval(refreshLive, 2 * 60_000).unref();

	console.timeEnd('[main] Start');
	Logger.info(
		`Bereit - ${commands.size} Commands, ${counts.modules} Module, ${counts.channels} Channel(s), ${counts.filters} Filter, ${counts.reminders} Reminder, Prefix '${config.prefix}'${config.parallelMode ? ' (Parallelbetrieb)' : ''}`,
	);
};

process.on('unhandledRejection', (reason) => {
	Logger.warn('Unhandled rejection', reason);
});

process.once('SIGINT', () => {
	client.close();
	void bot.DB.disconnect().finally(() => process.exit(0));
	setTimeout(() => process.exit(0), 1500).unref();
});

start().catch((e) => {
	Logger.error('[main] Start fehlgeschlagen', e);
	process.exit(1);
});
