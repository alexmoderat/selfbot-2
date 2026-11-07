const { Logger } = require('../misc/logger.js');

// Command-Ausfuehrungen und Fehler in die DB (bisher singletons/logger.ts)

const stringifySafe = (value) => {
	if (value === undefined) {
		return null;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
};

/** Fire-and-forget */
const logCommandExecution = (data) => {
	bot.DB.CommandExecution.create({ ...data, result: data.result?.slice(0, 1000) ?? null }).catch((e) =>
		Logger.warn('[log] Command-Log fehlgeschlagen', e.message),
	);
};

/** Fehler speichern, gibt die ID fuer die Chat-Antwort zurueck (null wenn das Speichern scheitert) */
const logError = async (type, error, options = {}) => {
	try {
		const id = await bot.DB.nextId('errors');
		await bot.DB.ErrorLog.create({
			_id: id,
			type,
			origin: options.origin ?? null,
			message: String(error?.message ?? error).slice(0, 2000),
			stack: error?.stack?.slice(0, 5000) ?? null,
			context: stringifySafe(options.context),
			arguments: stringifySafe(options.arguments),
		});
		return id;
	} catch (e) {
		Logger.error('[log] Fehler-Log fehlgeschlagen', { original: error, logError: e });
		return null;
	}
};

module.exports = { logCommandExecution, logError };
