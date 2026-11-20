// Logger wie bei DontAddThisBot (LogLevel + Logger.log), ohne winston: pm2 sammelt stdout/stderr ohnehin

const LogLevel = {
	ERROR: 'error',
	WARN: 'warn',
	INFO: 'info',
	DEBUG: 'debug',
	SILLY: 'silly',
};

const ORDER = { error: 0, warn: 1, info: 2, debug: 3, silly: 4 };
const threshold = ORDER[process.env.LOG_LEVEL ?? 'info'] ?? ORDER.info;

const Logger = {
	log(level, ...args) {
		if ((ORDER[level] ?? ORDER.info) > threshold) {
			return;
		}
		if (level === LogLevel.ERROR) {
			console.error(...args);
		} else if (level === LogLevel.WARN) {
			console.warn(...args);
		} else {
			console.log(...args);
		}
	},
	error: (...args) => Logger.log(LogLevel.ERROR, ...args),
	warn: (...args) => Logger.log(LogLevel.WARN, ...args),
	info: (...args) => Logger.log(LogLevel.INFO, ...args),
	debug: (...args) => Logger.log(LogLevel.DEBUG, ...args),
};

module.exports = { Logger, LogLevel };
