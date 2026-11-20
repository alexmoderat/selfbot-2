const { client } = require('../util/twitch/connections.js');
const { Logger, LogLevel } = require('../misc/logger.js');

// Wie DontAddThisBot: alle aktiven Channels aus der DB joinen. Waehrend des Parallelbetriebs mit dem alten selfbot
// begrenzt config.onlyChannels die Liste (sonst antworten beide Bots).

const joinableNames = () => {
	const only = bot.Config.onlyChannels;
	const names = bot.Channels.getJoinable().map((i) => i.name);
	return Array.isArray(only) && only.length > 0 ? names.filter((name) => only.includes(name)) : names;
};

const main = async () => {
	const names = joinableNames();
	for (const name of names) {
		if (!client.joinedChannels.has(name)) {
			await new Promise((resolve) => setTimeout(resolve, 8));
			client.join(name).catch((e) => Logger.log(LogLevel.WARN, `[join] ${name}: ${e.message}`));
		}
	}
	Logger.log(LogLevel.INFO, `[twitch] ${names.length} Channel(s) per IRC`);
};

/** Ob der Bot einen Channel bedienen soll (Parallelbetrieb) */
const isServed = (name) => {
	const only = bot.Config.onlyChannels;
	return !Array.isArray(only) || only.length === 0 || only.includes(name);
};

module.exports = { main, isServed };
