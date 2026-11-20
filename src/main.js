// ██████╗  ██████╗ ███╗   ██╗████████╗ █████╗ ██████╗ ██████╗ ████████╗██╗  ██╗██╗███████╗██████╗  ██████╗ ████████╗
// ██╔══██╗██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██║██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝
// ██║  ██║██║   ██║██╔██╗ ██║   ██║   ███████║██║  ██║██║  ██║   ██║   ███████║██║███████╗██████╔╝██║   ██║   ██║
// ██║  ██║██║   ██║██║╚██╗██║   ██║   ██╔══██║██║  ██║██║  ██║   ██║   ██╔══██║██║╚════██║██╔══██╗██║   ██║   ██║
// ██████╔╝╚██████╔╝██║ ╚████║   ██║   ██║  ██║██████╔╝██████╔╝   ██║   ██║  ██║██║███████║██████╔╝╚██████╔╝   ██║
// ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝╚══════╝╚═════╝  ╚═════╝    ╚═╝

const { Logger, LogLevel } = require('./misc/logger.js');

const nodeCron = require('node-cron');
const { client } = require('./util/twitch/connections.js');
const pubsub = require('./util/twitch/pubSub.js');
const { Twitch } = require('./clients/twitch.js');
const { bannedChannels } = require('./util/twitch/bannedChannels');
const { SocketConnection } = require('./token/socket.js');

global.bot = {};
bot.Redis = require('./database/redis.js');
bot.DB = require('./database/db.js');
bot.Utils = require('./misc');
bot.SQL = require('./database/postgres.js');

// selfbot: unsere Dienste (Channels, Filter, Commands, Module, Crons, Dashboard ...) starten, siehe src/selfbot/attach.js
bot.Ready = require('./selfbot/attach.js').start();

if (bot.Config.dont.api) require('./api/server'); // selfbot: Donts API (poros.lol-Backend) nur auf Wunsch, config.dont.api

client.on('ready', async () => {
	Logger.log(LogLevel.SILLY, 'Connected to chat!');
	if (bot.Config.dont.pubsub) pubsub.init(); // selfbot: Donts PubSub (Twitch hat PubSub abgeschaltet), config.dont.pubsub
	if (bot.Config.dont.kattahCookie) {
		// selfbot: persoenlicher Cron von kattah, config.dont.kattahCookie
		nodeCron.schedule('5 */2 * * *', () => {
			client.say('kattah', '!cookie');
		});
	}
	Twitch();

	if (bot.Config.dont.bannedChannels) await bannedChannels(); // selfbot: config.dont.bannedChannels
	if (bot.Config.dont.stvSocket) await SocketConnection(7777); // selfbot: config.dont.stvSocket
});

client.on('close', (err) => {
	if (err != null) {
		Logger.log(LogLevel.ERROR, 'Client closed due to error', err);
	}
	process.exit(0);
});
