const { baseUrl } = require('../token/user-tokens.js');

/**
 * Link zum Dashboard (ninou2, 27.10.2026: "should be command : !botwebsite !bw" - dort Commands mit Beschreibung
 * sehen und Custom Commands verwalten, "just like the fossa custom command menu").
 */
// Direkt aufs Dashboard: ohne Sitzung fuehrt es zum Login, mit Sitzung gleich hinein (ninou2: "wrong link")
const formatBotWebsite = (url) =>
	`bot website: ${url}/dashboard (log in with Twitch) - all commands with descriptions, manage custom commands, banphrases and notifications.`;

module.exports = {
	name: 'botwebsite',
	aliases: ['bw'],
	cooldown: 5000,
	description: "Posts the link to the bot's website (command list, custom commands, banphrases, notifications).",
	usage: 'botwebsite | bw',
	flags: ['mention'],
	execute: async (client, msg) => {
		const url = baseUrl();
		if (!url) {
			return Promise.resolve({ success: false, text: 'The bot website is not configured.' });
		}

		return Promise.resolve({ text: formatBotWebsite(url) });
	},
};

Object.assign(module.exports, { formatBotWebsite });
