const { readdirSync } = require('node:fs');
const path = require('node:path');
const { filterByConfig } = require('../../config.js');
const { Logger } = require('../../misc/logger.js');

// Wie DontAddThisBot: alle Dateien in src/commands/ werden geladen, Name und Aliase in zwei Maps.
// Zusaetzlich: Config-Filter (blacklist/whitelist), doppelte Namen sind ein Fehler, init()/destroy() je Command.

const COMMAND_DIR = path.join(__dirname, '..', '..', 'commands');

const commands = new Map();
const aliases = new Map();

const FLAGS = new Set([
	'confirm', // destruktive Argumente (reset/delete/...) brauchen ein abschliessendes "yes"
	'cooldown-notice', // meldet einmal pro Sperre die Restzeit statt stumm zu bleiben
	'external-input', // Ergebnis enthaelt fremden Text
	'mention', // Antwort beginnt mit "@user, "
	'mod', // nur Channel-Mods, Broadcaster und Administratoren
	'no-prefix', // zusaetzlich ueber das Zweit-Prefix "!" aufrufbar
	'non-nullable',
	'block', // Filter: Ziel-User (erstes Argument) kann den Aufrufer blocken
	'opt-out', // Filter: Ziel-User (erstes Argument) kann sich austragen
	'owner', // nur Bot-Administratoren
	'pipe',
	'skip-banphrase', // Antwort wird nicht gegen Banphrases geprueft
	'whitelist', // nur auf ausdrueckliche Freigabe
]);

/** Fehlende Felder auffuellen, damit der Handler nicht ueberall pruefen muss */
const normalize = (definition, file) => {
	if (!definition?.name || typeof definition.execute !== 'function') {
		throw new Error(`Command ${file}: name und execute() fehlen`);
	}
	const flags = definition.flags ?? [];
	const unknown = flags.filter((i) => !FLAGS.has(i));
	if (unknown.length > 0) {
		throw new Error(`Command ${definition.name}: unbekannte Flags ${unknown.join(', ')}`);
	}

	return {
		aliases: [],
		cooldown: 0,
		description: null,
		usage: null,
		params: [],
		whitelistResponse: null,
		dynamicDescription: null,
		ready: true,
		data: {},
		...definition,
		flags: Object.freeze([...flags]),
	};
};

/** Rechte-Stufe wie in sb-v2s Permission-Feld */
const permissionOf = (command) => (command.flags.includes('owner') ? 'owner' : command.flags.includes('mod') ? 'mod' : 'everyone');

const register = (command) => {
	commands.set(command.name, command);
	for (const alias of command.aliases) {
		aliases.set(alias, command.name);
	}

	if (typeof command.init === 'function') {
		command.ready = false;
		Promise.resolve(command.init(command))
			.then(() => {
				command.ready = true;
			})
			.catch((e) => Logger.warn(`[commands] Initialisierung von ${command.name} fehlgeschlagen`, e));
	}
};

const startCmds = (config) => {
	for (const command of commands.values()) {
		command.destroy?.(command);
	}
	commands.clear();
	aliases.clear();

	const files = readdirSync(COMMAND_DIR).filter((file) => file.endsWith('.js'));
	const definitions = files.map((file) => normalize(require(path.join(COMMAND_DIR, file)), file));

	const names = definitions.flatMap((i) => [i.name, ...i.aliases]);
	const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
	if (duplicates.length > 0) {
		throw new Error(`Doppelte Command-Namen oder Aliase: ${[...new Set(duplicates)].join(', ')}`);
	}

	for (const command of filterByConfig(definitions, (i) => i.name, config.modules.commands)) {
		register(command);
	}
	return { commands, aliases };
};

/** Command per Name oder Alias */
const getCommand = (identifier) => {
	if (identifier && typeof identifier === 'object') {
		return identifier;
	}
	const name = String(identifier ?? '').toLowerCase();
	return commands.get(name) ?? commands.get(aliases.get(name)) ?? null;
};

module.exports = { startCmds, getCommand, commands, aliases, permissionOf, normalize, FLAGS };
