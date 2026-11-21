// selfbot-next - alexmoderat's Twitch-Bot auf der Grundlage von DontAddThisBot.
// Donts src/main.js legt "bot" an (Redis, DB, Utils, SQL) und ruft start() hier auf; alles Eigene haengt sich daran
// (siehe docs/dont-konzept.md). Eigene Namen am Dont-Objekt: Config, PG (unser Pool), Cache (unser Redis),
// DB.<Model> und Utils.<Helfer> werden ergaenzt, nichts von Donts Belegung wird ueberschrieben.

const { getConfig } = require('./config.js');
const { Logger, LogLevel } = require('./misc/logger.js');

const config = getConfig();

Object.assign(bot, {
	Config: config,
	PG: require('./database/postgres.js'),
	Cache: require('./database/redis.js').create(config.redis),
	Logger,
	/** Twitch-IDs der gerade live gemeldeten Channels */
	Live: new Set(),
});
Object.assign(bot.DB, require('./database/db.js'));
Object.assign(bot.Utils, require('./misc'));

const { client } = require('./util/twitch/connections.js');
const { Twitch, platform } = require('./clients/twitch.js');
const { startCmds, commands } = require('./clients/modules/commands.js');
const ChatModules = require('./clients/modules/chat-modules.js');
const { startServices, chatLogger, joiner } = require('./clients/startup.js');
const { getTimers } = require('./clients/modules/timers.js');

bot.Client = client;
bot.Twitch = platform;
bot.Channels = require('./util/channels.js');
bot.Users = require('./util/users.js');
bot.Filter = require('./util/filter.js');
bot.Banphrase = require('./util/banphrase.js');
bot.AFK = require('./util/afk.js');
bot.Reminders = require('./util/reminders.js');
// Custom Commands der Channels (!discord usw.), der Handler fragt sie, wenn kein eingebauter Command passt
bot.CustomCommands = require('./util/custom-commands.js');
bot.ChatModules = ChatModules;
bot.Commands = commands;

/** Eigene Dienste starten; wird von Donts main.js aufgerufen und liefert das Ready-Promise (bot.Ready) */
const start = async () => {
	const startedAt = Date.now();
	await bot.DB.connect(config.postgres);

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

	// Web (Dashboard, OAuth, Status-/Statistikseiten, /v1) und interne API - Ports aus config.json, nur 127.0.0.1
	if (config.web?.port) {
		require('./api/server.js').startWebServer(config.web.port);
	}
	if (config.api?.port) {
		bot.API = require('./api/internal.js')(config.api.port);
	}

	// Event-Handler nur einmal registrieren; nach Reconnects joint dank-twitch-irc die Channels selbst neu
	client.once('ready', async () => {
		Logger.log(LogLevel.SILLY, 'Connected to chat!');
		await Twitch();
		startServices();
		const crons = getTimers(config);
		Logger.info(`[cron] ${crons.length} Cron(s) aktiv: ${crons.map((i) => i.name).join(', ')}`);
	});

	client.on('close', (err) => {
		if (err != null) {
			Logger.log(LogLevel.ERROR, 'Client closed due to error', err);
		}
		process.exit(err ? 1 : 0);
	});

	// Live-Status: beim Start und alle 2 Minuten per Helix (bis PubSub stream-up/-down portiert ist)
	const refreshLive = () => platform.loadLiveChannels().catch((e) => Logger.warn('[twitch] Live-Status nicht ladbar', e.message));
	await refreshLive();
	setInterval(refreshLive, 2 * 60_000).unref();

	Logger.info(`[main] Start: ${Date.now() - startedAt}ms`);
	Logger.info(
		`Bereit - ${commands.size} Commands, ${counts.modules} Module, ${counts.channels} Channel(s), ${counts.filters} Filter, ${counts.reminders} Reminder, Prefix '${config.prefix}'${config.parallelMode ? ' (Parallelbetrieb)' : ''}`,
	);
};

require('./util/crash-guard.js').installCrashGuard(Logger);

process.on('unhandledRejection', (reason) => {
	Logger.warn('Unhandled rejection', reason);
});

// pm2 stoppt mit SIGINT: Gepuffertes noch schreiben (bis zu einer Minute Zeilen, fuenf Minuten Meta)
process.once('SIGINT', () => {
	client.close();
	void Promise.all([chatLogger.flush(), joiner.stop()])
		.catch(() => {})
		.finally(() => bot.DB.disconnect())
		.finally(() => process.exit(0));
	setTimeout(() => process.exit(0), 3000).unref();
});

module.exports = {
	start: () =>
		start().catch((e) => {
			Logger.error('[main] Start fehlgeschlagen', e);
			process.exit(1);
		}),
};
