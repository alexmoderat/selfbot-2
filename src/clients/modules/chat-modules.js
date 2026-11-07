const { readdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const { filterByConfig } = require('../../config.js');
const { Logger } = require('../../misc/logger.js');

// Chat-Module (bisher classes/chat-module.ts): Dateien in src/modules/ mit
//   { name, description, scope: 'global' | 'channel', events: { message(data, args) {}, usernotice(...) {}, ... } }
// scope 'channel' laeuft nur in Channels mit Eintrag in channelChatModules (args = dort gespeicherte Argumente).
// Events: message, usernotice, clearchat, clearmsg, notice, channelState, online, offline, raw PubSub-Namen

const MODULE_DIR = path.join(__dirname, '..', '..', 'modules');
const modules = [];
const channelModules = new Map(); // channelId -> Map(moduleName -> args)

const load = async (config) => {
	modules.length = 0;
	const files = existsSync(MODULE_DIR) ? readdirSync(MODULE_DIR).filter((file) => file.endsWith('.js')) : [];
	const definitions = files.map((file) => require(path.join(MODULE_DIR, file)));
	for (const definition of filterByConfig(definitions, (i) => i.name, config.modules.modules)) {
		modules.push(definition);
		await definition.init?.();
	}

	channelModules.clear();
	for (const doc of await bot.DB.ChannelChatModule.find({}).lean()) {
		if (!channelModules.has(doc.channelId)) {
			channelModules.set(doc.channelId, new Map());
		}
		channelModules.get(doc.channelId).set(doc.module, doc.args ?? null);
	}
	return modules.length;
};

/** Event an alle passenden Module verteilen; Fehler eines Moduls stoppen die anderen nicht */
const dispatch = (event, data) => {
	for (const module of modules) {
		const handler = module.events?.[event];
		if (!handler) {
			continue;
		}

		let args = null;
		if (module.scope === 'channel') {
			const assigned = data.channel ? channelModules.get(data.channel.id) : null;
			if (!assigned?.has(module.name)) {
				continue;
			}
			args = assigned.get(module.name);
		}

		Promise.resolve()
			.then(() => handler(data, args))
			.catch((e) => Logger.warn(`[module] ${module.name}/${event} fehlgeschlagen`, e));
	}
};

const list = () => [...modules];

module.exports = { load, dispatch, list };
