const { Logger } = require('../misc/logger.js');
const { got } = require('../token/got.js');
const { getPermissions } = require('../clients/modules/handler.js');
const { Script, createContext } = require('node:vm');
const crypto = require('node:crypto');

const gql = require('../token/gql.js');
const { idOf, modShortcuts } = require('../util/commands/debug/mod-shortcuts.js');
const { getModerationStats } = require('../clients/modules/chat/banphrase-filter.js');

// Supibots commands/debug (alexmoderat, 23.10.2026: "Supibot debug + Schwaerzen"). Aus sb-v2s eval dazu:
// - Aliase eval/js
// - nur alexmoderat selbst, nicht jeder Administrator: das ist Remote Code Execution mit vollem Prozesszugriff
//   (sb-v2, 25.08.2026 - bei einer fremd betriebenen Instanz waere "Administrator" zu weit)
// - Zugangsdaten werden in der Ausgabe geschwaerzt: das Script bekommt die echte Umgebung, sonst schlagen Aufrufe
//   mit "Invalid token" fehl; geschwaerzt wird erst die fertige Antwort.
// Supibots importGist entfaellt (es gibt keinen pastebin-Command).

const OWNER_LOGIN = 'alexmoderat';
const SECRET_KEY = /token|secret|password|webhook|key/i;
const MIN_SECRET_LENGTH = 8; // kurze Werte nicht pauschal ersetzen
const REDACTED = '[redacted]';

/** Alle Secret-Werte aus der Umgebung (.env) */
const collectSecrets = (env = process.env) => {
	const result = new Set();
	for (const [key, value] of Object.entries(env)) {
		if (SECRET_KEY.test(key) && typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) {
			result.add(value);
		}
	}

	return result;
};

const scrub = (text, secrets) => {
	let result = text;
	for (const secret of secrets) {
		result = result.split(secret).join(REDACTED);
	}

	return result;
};

/** Namen der Channels, deren Twitch-ID gerade live gemeldet ist */
const liveChannelNames = (channels, liveIds) => channels.filter((i) => i.twitchId && liveIds.has(i.twitchId)).map((i) => i.Name);

/**
 * Kuerzel fuer den eval (alexmoderat, 05.11.2026: "kuerzer wie hier" - anderer Bot mit sb.svc.twitch.gql.getUser).
 * z. B. "=js return live().join(', ')" oder "=js return (await gql.getUserInfo('kattah'))?.followers".
 */
const shortcuts = () => {
	const twitch = bot.Twitch;
	const channels = () => bot.Channels.getJoinable();

	return {
		twitch,
		channels,
		live: () => liveChannelNames(channels(), twitch.liveIds),
		gql,
		helix: got('Helix'),
		mod: modShortcuts,
		id: idOf,
		// Momentaufnahme pro Aufruf: "=js moderation" gibt das JSON direkt aus
		moderation: getModerationStats(),
	};
};

const command = {
	name: 'debug',
	aliases: ['eval', 'js'],
	cooldown: { user: 0 },
	access: { global: 1 },
	description: 'supiniHack',
	usage: 'debug <code> | debug return <code> | debug function:<expression> <args…> — shortcuts: twitch, channels(), live(), gql, helix, mod.restrict/ban/timeout/unban, id(), moderation',
	flags: ['skip-banphrase'],
	params: [{ name: 'function', type: 'string' }],
	whitelistResponse: 'Only administrators can access the debug command!',
	execute: async ({ client, message: msg }) => {
		const args = [...msg.args];
		const permissions = getPermissions(msg);
		if (!permissions.administrator || msg.sender.name !== OWNER_LOGIN) {
			return { success: false, text: `Only administrators can access the debug command!` };
		}

		const string = args.join(' ');
		let scriptArgs;
		let scriptString;
		if (msg.params.function) {
			scriptString = msg.params.function;
			scriptArgs = [...args];
		} else if (!string.includes('return')) {
			scriptString = string;
		} else {
			scriptString = `(async () => {"use strict"; \n${string}\n})()`;
		}

		const secrets = collectSecrets();
		let script;
		try {
			script = new Script(scriptString);
		} catch (e) {
			Logger.info(e);
			return { success: false, text: scrub(`Parse: ${String(e)}`, secrets) };
		}

		try {
			const scriptContext = createContext({
				crypto,
				version: process.version,
				msg,
				// "bot" statt sb/core: alles Globale des Bots (Channels, Users, DB, Twitch, ...)
				bot,
				...shortcuts(),
				args: scriptArgs ?? [],
			});

			let result = await script.runInNewContext(scriptContext, { timeout: 2500 });
			if (typeof result === 'undefined') {
				return { success: true, text: 'Done' };
			}

			if (result?.constructor?.name === 'Object') {
				result = JSON.stringify(result, null, 4);
			}

			return { success: true, text: scrub(String(result), secrets) };
		} catch (e) {
			Logger.info(e);
			return { success: false, text: scrub(`Execute: ${String(e)}`, secrets) };
		}
	},
};

module.exports = { command };

Object.assign(module.exports, { collectSecrets, scrub, liveChannelNames });
