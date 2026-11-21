const { inspect } = require('node:util');
const { Logger: DontLogger, LogLevel } = require('../../misc/logger.js');

// Logging wie bei DontAddThisBot: alles laeuft ueber Donts winston-Logger (src/misc/logger.js), gleiches Format
// "[Zeit] Emoji LEVEL Text", gleiche Dateien (.logs/combined.log, .logs/error.log). Dieser Baum ruft ihn mit mehreren
// Argumenten auf (Text, Fehler, Objekte); die werden zu einem Text zusammengefuegt. Standard wie bei Dont: alles (silly).
// LOG_LEVEL=info|warn|error blendet die geschwaetzigen Stufen aus.

const ORDER = { error: 0, warn: 1, info: 2, debug: 3, silly: 4 };
const threshold = ORDER[process.env.LOG_LEVEL ?? 'silly'] ?? ORDER.silly;

const toText = (value) => {
	if (typeof value === 'string') {
		return value;
	}
	return value instanceof Error ? (value.stack ?? value.message) : inspect(value, { depth: 3, breakLength: 200 });
};

const Logger = {
	log(level, ...args) {
		if ((ORDER[level] ?? ORDER.info) > threshold) {
			return;
		}
		DontLogger.log(level, args.map(toText).join(' '));
	},
	error: (...args) => Logger.log(LogLevel.ERROR, ...args),
	warn: (...args) => Logger.log(LogLevel.WARN, ...args),
	info: (...args) => Logger.log(LogLevel.INFO, ...args),
	debug: (...args) => Logger.log(LogLevel.DEBUG, ...args),
};

module.exports = { Logger, LogLevel };
