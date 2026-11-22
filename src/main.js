// selfbot-next - alexmoderat's Twitch-Bot. Einstieg: die Klasse TwitchBot haelt die Dienste und startet in fester Reihenfolge
// Datenbank -> Channels/Filter/AFK -> Commands -> Chat-Module -> Reminder -> Konsole -> Web/API -> Chat-Events.
// Die Dienste erreichen den Bot weiter ueber das globale "bot" (die eine TwitchBot-Instanz).

const { getConfig } = require('./config.js');
const { Logger, LogLevel } = require('./misc/logger.js');

class TwitchBot {
	constructor(config) {
		// Muss vor dem Laden der Dienste stehen: manche lesen bot beim Import
		global.bot = this;

		this.Config = config;
		this.Logger = Logger;
		this.PG = require('./database/postgres.js');
		this.Cache = require('./database/redis.js').create(config.redis);
		/** Twitch-IDs der gerade live gemeldeten Channels */
		this.Live = new Set();
		this.DB = require('./database/db.js');
		this.Utils = require('./misc');

		const { client } = require('./util/twitch/connections.js');
		this.Client = client;
		this.twitch = require('./clients/twitch.js');
		this.Twitch = this.twitch.platform;

		this.commandHandler = require('./commandHandler.js').commandHandler;
		this.Commands = this.commandHandler.commands;
		this.ChatModules = require('./clients/modules/chat-modules.js');
		this.startup = require('./clients/startup.js');

		this.Channels = require('./util/channels.js');
		this.Users = require('./util/users.js');
		this.Filter = require('./util/filter.js');
		this.Banphrase = require('./util/banphrase.js');
		this.AFK = require('./util/afk.js');
		this.Reminders = require('./util/reminders.js');
		// Custom Commands der Channels (!discord usw.), der Handler fragt sie, wenn kein eingebauter Command passt
		this.CustomCommands = require('./util/custom-commands.js');

		/** Ready-Promise, wird von start() gesetzt */
		this.Ready = null;
	}

	/** Startet alles; das Ergebnis liegt als bot.Ready bereit */
	start() {
		this.Ready = this.run().catch((e) => {
			Logger.error('[main] Start fehlgeschlagen', e);
			process.exit(1);
		});
		return this.Ready;
	}

	async run() {
		const startedAt = Date.now();
		await this.connectDatabase();
		const counts = await this.initializeServices();
		await this.startWeb();
		this.setupChatHandlers();
		await this.startLiveRefresh();

		Logger.info(`[main] Start: ${Date.now() - startedAt}ms`);
		Logger.info(
			`Bereit - ${this.Commands.size} Commands, ${counts.modules} Module, ${counts.channels} Channel(s), ${counts.filters} Filter, ${counts.reminders} Reminder, Prefix '${this.Config.prefix}'${this.Config.parallelMode ? ' (Parallelbetrieb)' : ''}`,
		);
	}

	async connectDatabase() {
		await this.DB.connect(this.Config.postgres);
	}

	async initializeServices() {
		const counts = {
			channels: await this.Channels.load(),
			filters: await this.Filter.load(),
			banphrases: await this.Banphrase.load(),
			afk: await this.AFK.load(),
		};
		this.commandHandler.loadCommands(this.Config);
		counts.modules = await this.ChatModules.load(this.Config);
		// Reminder brauchen Channels (Zeit-Reminder feuern sofort nach dem Laden)
		counts.reminders = await this.Reminders.load();

		await require('./clients/console.js').start(this.Config.console.port);
		return counts;
	}

	/** Web (Dashboard, OAuth, Status-/Statistikseiten, /v1) und interne API - Ports aus config.json, nur 127.0.0.1 */
	async startWeb() {
		if (this.Config.web?.port) {
			require('./api/server.js').startWebServer(this.Config.web.port);
		}
		if (this.Config.api?.port) {
			this.API = require('./api/internal.js')(this.Config.api.port);
		}
	}

	/** Event-Handler nur einmal registrieren; nach Reconnects joint dank-twitch-irc die Channels selbst neu */
	setupChatHandlers() {
		this.Client.once('ready', async () => {
			Logger.log(LogLevel.SILLY, 'Connected to chat!');
			await this.twitch.Twitch();
			this.startup.startServices();
			const crons = require('./clients/modules/timers.js').getTimers(this.Config);
			Logger.info(`[cron] ${crons.length} Cron(s) aktiv: ${crons.map((i) => i.name).join(', ')}`);
		});

		this.Client.on('close', (err) => {
			if (err != null) {
				Logger.log(LogLevel.ERROR, 'Client closed due to error', err);
			}
			process.exit(err ? 1 : 0);
		});
	}

	/** Live-Status: beim Start und alle 2 Minuten per Helix (bis PubSub stream-up/-down portiert ist) */
	async startLiveRefresh() {
		const refresh = () => this.Twitch.loadLiveChannels().catch((e) => Logger.warn('[twitch] Live-Status nicht ladbar', e.message));
		await refresh();
		setInterval(refresh, 2 * 60_000).unref();
	}

	/** pm2 stoppt mit SIGINT: Gepuffertes noch schreiben (bis zu einer Minute Zeilen, fuenf Minuten Meta) */
	async shutdown() {
		this.Client.close();
		try {
			await Promise.all([this.startup.chatLogger.flush(), this.startup.joiner.stop()]);
		} catch {
			// beim Beenden egal
		}
		try {
			await this.DB.disconnect();
		} finally {
			process.exit(0);
		}
	}
}

const bot = new TwitchBot(getConfig());

require('./util/crash-guard.js').installCrashGuard(Logger);

process.on('unhandledRejection', (reason) => {
	Logger.warn('Unhandled rejection', reason);
});

process.once('SIGINT', () => {
	void bot.shutdown();
	setTimeout(() => process.exit(0), 3000).unref();
});

bot.start();
