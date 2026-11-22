const { ChatClient, AlternateMessageModifier, SlowModeRateLimiter } = require('@kararty/dank-twitch-irc');
const { twitch } = require('../../../config.json');

// Der eine ChatClient des Bots. Das Passwort ist ein fester User-Token (TWITCH_USER_TOKEN in .env), eine Erneuerung entfaellt.
const client = new ChatClient({
	username: twitch.username,
	password: twitch.oauth ?? process.env.TWITCH_USER_TOKEN,
	rateLimits: twitch.rateLimits ?? 'verifiedBot', // unser Konto ist nicht verifiziert (config twitch.rateLimits: 'default')
	ignoreUnhandledPromiseRejections: true,
});

client.use(new AlternateMessageModifier(client));
client.use(new SlowModeRateLimiter(client, 10));
client.connect();

module.exports = { client };
