const { commands, toListed } = require('../clients/modules/commands.js');
const { setTimeout: sleep } = require('node:timers/promises');

const { getConfig } = require('../config.js');
const { invocationPrefix, loadOtherBotCommands } = require('../misc/command-listing.js');
const { uploadToOwnHaste } = require('../misc/haste.js');
const { baseUrl } = require('../misc/user-tokens.js');

const { otherBotCommandsDir } = getConfig().values;

const CHUNK_LIMIT = 300;
const MERGE_LIMIT = 490;
// Vorfall 17.09.2026: Nachrichten direkt hintereinander verwarf Twitchs Spam-Schutz (aus sb-v2)
const SEND_DELAY = 400;

/** Eigene Commands plus die "!"-Commands des utility-bots, alphabetisch */
const buildEntries = () => {
	const own = [...commands.values()].map((i) => i.toListed());
	const prefix = bot.Config.prefix;
	const known = new Set(own.flatMap((i) => [i.Name, ...i.Aliases]));
	const other = otherBotCommandsDir ? loadOtherBotCommands(otherBotCommandsDir).filter((i) => !known.has(i.Name) && i.permission !== 'owner') : [];

	return [
		...own.map((i) => ({ command: i, prefix: invocationPrefix(i, prefix), chat: true })),
		...other.map((i) => ({ command: i, prefix: '!', chat: true })),
	].sort((a, b) => a.command.Name.localeCompare(b.command.Name));
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
 * Link zur Command-Liste: die oeffentliche Seite /commands (alexmoderat, 01.11.2026: "wäre glaube richtige Website
 * besser"), ohne WEB_BASE_URL weiter die Haste-Liste
 */
const buildCommandsUrl = async () => {
	const base = baseUrl();
	return base ? `${base}/commands` : await uploadCommandList(buildEntries());
};

/**
 * Listet die eigenen Commands, getrennt von Nightbot/StreamElements-Custom-Commands (aus sb-v2).
 * ninou2, 17.09.2026: "!commands" ging an Nightbot/StreamElements -> "maybe make it !botcommands".
 * Enthaelt auch die "!"-Commands des utility-bots, solange der noch auf sb-v2-Code laeuft
 * (ninou2, 20.09.2026: "some commands are missing like !tn").
 */
module.exports = {
	name: 'botcommands',
	aliases: ['botcmds'],
	cooldown: 3000,
	description: "Lists this bot's own commands with explanations (separate from Nightbot/StreamElements custom commands).",
	usage: 'botcommands',
	execute: async (client, msg) => {
		const entries = buildEntries();
		if (entries.length === 0) {
			return { text: `@${msg.displayName}, no commands loaded.` };
		}

		// ninou2, 17.09.2026: Prefix vor jedem Namen, in 300er-Haeppchen, Link zum Schluss
		const chatEntries = entries.filter((i) => i.chat);
		const chunks = [];
		let current = `@${msg.displayName}, ${chatEntries.length} commands:`;
		for (const { command, prefix: p } of chatEntries) {
			const name = `${p}${command.Name}`;
			const candidate = `${current} ${name},`;
			if (candidate.length > CHUNK_LIMIT) {
				chunks.push(current.replace(/,$/, ''));
				current = `${name},`;
			} else {
				current = candidate;
			}
		}
		chunks.push(current.replace(/,$/, ''));

		const url = await buildCommandsUrl();

		// Kein Satzpunkt direkt hinter der URL, Twitch linkt ihn sonst mit (ninou2, 20.09.2026)
		const linkLine = url ? `check all commands and their aliases in here : ${url}` : 'no haste link available right now';
		const lastMerged = `${chunks.at(-1)} — ${linkLine}`;
		if (lastMerged.length <= MERGE_LIMIT) {
			chunks[chunks.length - 1] = lastMerged;
		} else {
			chunks.push(linkLine);
		}

		for (let i = 0; i < chunks.length; i++) {
			if (i > 0) {
				await sleep(SEND_DELAY);
			}

			await msg.send(chunks[i]);
		}

		return { text: null };
	},
};

Object.assign(module.exports, { buildEntries, buildCommandsUrl });
