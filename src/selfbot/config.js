const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

// config.json (lokal, git-ignoriert) hat Vorrang, sonst die Vorlage example.config.json
const ROOT = path.join(__dirname, '..', '..');

const REQUIRED = ['selfName', 'selfId', 'prefix', 'messageLimit', 'dedupeWindow', 'postgres', 'redis', 'console', 'responses', 'values', 'modules'];

const validate = (config) => {
	const missing = REQUIRED.filter((key) => config[key] === undefined);
	if (missing.length > 0) {
		throw new Error(`config.json: fehlende Eintraege ${missing.join(', ')}`);
	}
	if (typeof config.prefix !== 'string' || config.prefix.length === 0) {
		throw new Error('config.json: prefix muss ein nicht-leerer String sein');
	}
	for (const kind of ['commands', 'modules', 'crons']) {
		const list = config.modules[kind];
		if (!list || !Array.isArray(list.blacklist) || !Array.isArray(list.whitelist)) {
			throw new Error(`config.json: modules.${kind} braucht blacklist und whitelist`);
		}
		if (list.blacklist.length > 0 && list.whitelist.length > 0) {
			throw new Error(`config.json: modules.${kind} kann blacklist und whitelist nicht kombinieren`);
		}
	}
	return config;
};

/** Schalter fuer Donts eigene Teile (docs/dont-konzept.md); alles aus, bis config.json "dont" etwas freigibt */
const DONT_DEFAULTS = { api: false, pubsub: false, kattahCookie: false, bannedChannels: false, stvSocket: false };

const withDontDefaults = (value) => ({
	...value,
	dont: {
		...DONT_DEFAULTS,
		...value.dont,
		commands: { disableAll: true, whitelist: [], blacklist: [], ...value.dont?.commands },
	},
});

let config = null;
exports.getConfig = () => {
	if (config) {
		return config;
	}

	const local = path.join(ROOT, 'config.json');
	const file = existsSync(local) ? local : path.join(ROOT, 'example.config.json');
	config = withDontDefaults(validate(JSON.parse(readFileSync(file, 'utf8'))));
	return config;
};

/** Wie Supibots filterModuleDefinitions: disableAll > whitelist > blacklist */
exports.filterByConfig = (items, getName, list) => {
	if (list.disableAll) {
		return [];
	} else if (list.whitelist.length > 0) {
		return items.filter((i) => list.whitelist.includes(getName(i)));
	}
	return items.filter((i) => !list.blacklist.includes(getName(i)));
};

/** Nur fuer Tests */
exports.setConfig = (value) => {
	config = value && withDontDefaults(value);
};
