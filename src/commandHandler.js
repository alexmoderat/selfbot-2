const { readdirSync } = require('node:fs');
const path = require('node:path');
const { filterByConfig } = require('./config.js');
const { Logger } = require('./misc/logger.js');

// CommandHandler: laedt alle Dateien in src/commands/, haelt Name und Aliase in zwei Maps und loest Commands auf.
// Config-Filter (blacklist/whitelist), doppelte Namen sind ein Fehler, init()/destroy() je Command.

const COMMAND_DIR = path.join(__dirname, 'commands');

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

	const command = {
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

	// Alte Feldnamen (selfbots Command-Klasse) als Getter, damit portierte Commands, Module und Web gleich lesen
	for (const [legacy, field] of Object.entries(LEGACY_FIELDS)) {
		Object.defineProperty(command, legacy, { get: () => command[field], enumerable: false });
	}
	Object.defineProperty(command, 'permission', { get: () => permissionOf(command), enumerable: false });
	Object.defineProperty(command, 'toListed', { value: () => toListed(command), enumerable: false });
	return command;
};

const LEGACY_FIELDS = {
	Name: 'name',
	Aliases: 'aliases',
	Cooldown: 'cooldown',
	Description: 'description',
	Usage: 'usage',
	Flags: 'flags',
	Params: 'params',
	Whitelist_Response: 'whitelistResponse',
	Dynamic_Description: 'dynamicDescription',
};

/** Rechte-Stufe wie in sb-v2s Permission-Feld */
const permissionOf = (command) => (command.flags.includes('owner') ? 'owner' : command.flags.includes('mod') ? 'mod' : 'everyone');

/** Listenform wie bisher (Command.toListed) fuer help, how, botcommands und die Web-Seite /commands */
const toListed = (command) => ({
	Name: command.name,
	Aliases: command.aliases,
	Description: command.description,
	Usage: command.usage,
	permission: permissionOf(command),
	noPrefix: command.flags.includes('no-prefix'),
});

class CommandHandler {
	commands = new Map();
	aliases = new Map();

	register(command) {
		this.commands.set(command.name, command);
		for (const alias of command.aliases) {
			this.aliases.set(alias, command.name);
		}

		if (typeof command.init === 'function') {
			command.ready = false;
			Promise.resolve(command.init(command))
				.then(() => {
					command.ready = true;
				})
				.catch((e) => Logger.warn(`[commands] Initialisierung von ${command.name} fehlgeschlagen`, e));
		}
	}

	/** (Neu) laden: alte Commands abbauen, Dateien lesen, Config-Filter anwenden */
	loadCommands(config) {
		for (const command of this.commands.values()) {
			command.destroy?.(command);
		}
		this.commands.clear();
		this.aliases.clear();

		const files = readdirSync(COMMAND_DIR).filter((file) => file.endsWith('.js'));
		const definitions = files.map((file) => normalize(require(path.join(COMMAND_DIR, file)), file));

		const names = definitions.flatMap((i) => [i.name, ...i.aliases]);
		const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
		if (duplicates.length > 0) {
			throw new Error(`Doppelte Command-Namen oder Aliase: ${[...new Set(duplicates)].join(', ')}`);
		}

		for (const command of filterByConfig(definitions, (i) => i.name, config.modules.commands)) {
			this.register(command);
		}
		return this;
	}

	/** Command per Name oder Alias */
	get(identifier) {
		if (identifier && typeof identifier === 'object') {
			return identifier;
		}
		const name = String(identifier ?? '').toLowerCase();
		return this.commands.get(name) ?? this.commands.get(this.aliases.get(name)) ?? null;
	}
}

const commandHandler = new CommandHandler();

/** Fehlschlag mit Antworttext (bisher isResultFailure aus classes/command) */
const isResultFailure = (input) => Boolean(input && typeof input === 'object' && input.success === false && typeof input.text === 'string');

module.exports = {
	CommandHandler,
	commandHandler,
	// Kurzformen auf dem gemeinsamen Handler (die Maps behalten ihre Identitaet)
	commands: commandHandler.commands,
	aliases: commandHandler.aliases,
	getCommand: (identifier) => commandHandler.get(identifier),
	isResultFailure,
	permissionOf,
	toListed,
	normalize,
	FLAGS,
};
