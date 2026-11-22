// Donts Commands rufen teils Dienste auf, die es nicht mehr gibt (z. B. egvault.7tv.io). got 11 wirft dann unter Node 24 nach
// den Wiederholungen ein 'error'-Ereignis, das ohne Abfangen den ganzen Prozess beendet. Solche Fehler aus HTTP-Anfragen werden
// nur geloggt; alles andere beendet den Prozess wie bisher (pm2 startet neu).

/** @param {unknown} error */
const isRequestError = (error) => {
	const name = error?.constructor?.name ?? '';
	return ['RequestError', 'HTTPError', 'TimeoutError', 'ReadError', 'MaxRedirectsError'].includes(name) && typeof error?.code === 'string';
};

/** @param {{ error: (...args: unknown[]) => void }} logger */
const installCrashGuard = (logger) => {
	process.on('uncaughtException', (error) => {
		if (isRequestError(error)) {
			logger.error(`[crash-guard] HTTP-Fehler ohne Abnehmer ignoriert: ${error.code} ${error.message}`);
			return;
		}
		logger.error('[crash-guard] Unerwarteter Fehler, Prozess endet', error);
		process.exit(1);
	});
};

module.exports = { isRequestError, installCrashGuard };
