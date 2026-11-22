const { commands } = require('../commandHandler.js');
const { getConfig } = require('../config.js');
const { invocationPrefix, loadOtherBotCommands } = require('./command-listing.js');
const { uploadToOwnHaste } = require('../token/haste.js');
const { baseUrl } = require('../token/user-tokens.js');

// Command-Katalog fuer die oeffentliche Seite /commands und den Cron bot-promo (bisher in commands/botcommands.js;
// der Command selbst ist entfernt, alexmoderat, 11.11.2026: kaum genutzt).

const { otherBotCommandsDir } = getConfig().values;

/** Eigene Commands plus die "!"-Commands des utility-bots, alphabetisch */
const buildEntries = () => {
	const own = [...commands.values()].map((i) => i.toListed());
	const prefix = bot.Config.prefix;
	const known = new Set(own.flatMap((i) => [i.Name, ...i.Aliases]));
	const other = otherBotCommandsDir ? loadOtherBotCommands(otherBotCommandsDir).filter((i) => !known.has(i.Name) && i.permission !== 'owner') : [];

	return [...own.map((i) => ({ command: i, prefix: invocationPrefix(i, prefix), chat: true })), ...other.map((i) => ({ command: i, prefix: '!', chat: true }))].sort((a, b) =>
		a.command.Name.localeCompare(b.command.Name),
	);
};

/** Volle Liste als Haste-Link (auch fuer den Cron bot-promo); null bei Fehler */
const uploadCommandList = async (entries) => {
	// ninou2, 29.09.2026: Aliase direkt neben dem Namen, mit demselben Prefix ("!streaktrack (!st)")
	const lines = entries.map(({ command, prefix: p }) => {
		const aliases = command.Aliases.length > 0 ? ` (${command.Aliases.map((i) => `${p}${i}`).join(', ')})` : '';
		const usage = command.Usage ? ` | usage: ${command.Usage}` : '';
		return `${p}${command.Name}${aliases} — ${command.Description ?? 'no description'}${usage}`;
	});

	try {
		return await uploadToOwnHaste(lines.join('\n'), { hash: 'cmds' });
	} catch {
		return null;
	}
};

/**
 * Link zur Command-Liste in der Werbe-Nachricht: der Tab "Use" im Dashboard (ninou2, 20.11.2026: "not the right link ...
 * this the correct link: https://auth.alexmoderat.eu/dashboard#use"); ohne WEB_BASE_URL weiter die Haste-Liste
 */
const buildCommandsUrl = async () => {
	const base = baseUrl();
	return base ? `${base}/dashboard#use` : await uploadCommandList(buildEntries());
};

module.exports = { buildEntries, buildCommandsUrl };
