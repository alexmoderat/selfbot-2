const { ChatClient, AlternateMessageModifier, SlowModeRateLimiter } = require('@kararty/dank-twitch-irc');
const { getConfig } = require('../../config.js');
const { getUserToken, invalidateUserToken } = require('../../token/helix.js');
const { Logger, LogLevel } = require('../../misc/logger.js');

// Wie DontAddThisBot: eine ChatClient-Instanz fuer den ganzen Bot (dank-twitch-irc).
// Unterschied: der Bot hat kein festes OAuth-Passwort, sondern einen User-Token, der sich alle paar Stunden
// erneuert. dank-twitch-irc liest client.configuration.password bei jeder neuen Verbindung, deshalb wird der
// Wert regelmaessig nachgezogen.

const { selfName } = getConfig();
const TOKEN_REFRESH_INTERVAL = 30 * 60_000;

const client = new ChatClient({
	username: selfName,
	password: undefined,
	// Kein verifizierter Bot (gibt es bei Twitch nicht mehr): normale Limits, 20 Nachrichten je 30 s
	rateLimits: 'default',
	ignoreUnhandledPromiseRejections: true,
});

client.use(new AlternateMessageModifier(client));
client.use(new SlowModeRateLimiter(client, 10));

const refreshPassword = async () => {
	client.configuration.password = await getUserToken();
};

/** Token holen, verbinden und das Passwort danach regelmaessig erneuern */
const connect = async () => {
	await refreshPassword();
	client.connect();

	setInterval(() => {
		refreshPassword().catch((e) => Logger.log(LogLevel.WARN, '[irc] Token-Erneuerung fehlgeschlagen', e.message));
	}, TOKEN_REFRESH_INTERVAL).unref();

	// Anmeldung abgelehnt: Token verwerfen, damit der Neustart (pm2) einen frischen holt
	client.on('error', (error) => {
		if (error?.name === 'LoginError') {
			void invalidateUserToken();
		}
	});
};

module.exports = { client, connect };
