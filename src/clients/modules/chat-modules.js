const { readdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const { filterByConfig } = require('../../config.js');
const { Logger } = require('../../misc/logger.js');
const { isServed } = require('../JoinChannels.js');

// Chat-Module (bisher classes/chat-module.ts, gleiche Schnittstelle): Dateien in src/modules/ mit
//   module.exports = { name, description, scope: 'global' | 'channel', initialize?, destroy?, handlers: { message(context, runtime) {}, ... } }
// scope 'channel' laeuft nur in Channels mit Eintrag in channelChatModules (runtime.args = dort gespeicherte Argumente).
// Events: message, online, offline, usernotice, userJoin, follow, channelState, clearchat, clearmsg sowie die
// PubSub-Namen (raw, modAction, automodQueue, lowTrust, ...). context enthaelt immer platform (bot.Twitch) und channel.

const MODULE_DIR = path.join(__dirname, '..', '..', 'modules');
const definitions = new Map();
const channelAttachments = new Map(); // channelId -> Map(name -> { args })

const reloadAttachments = async () => {
	channelAttachments.clear();
	const names = [...definitions.values()].filter((i) => i.scope === 'channel').map((i) => i.name);
	if (names.length === 0) {
		return;
	}
	for (const doc of await bot.DB.ChannelChatModule.find({ module: { $in: names } }).lean()) {
		if (!channelAttachments.has(doc.channelId)) {
			channelAttachments.set(doc.channelId, new Map());
		}
		channelAttachments.get(doc.channelId).set(doc.module, { args: doc.args ?? null });
	}
};

const load = async (config) => {
	definitions.clear();
	const files = existsSync(MODULE_DIR) ? readdirSync(MODULE_DIR).filter((file) => file.endsWith('.js')) : [];
	const all = files.map((file) => require(path.join(MODULE_DIR, file)));
	for (const definition of filterByConfig(all, (i) => i.name, config.modules.modules)) {
		if (definitions.has(definition.name)) {
			throw new Error(`Doppelter Modulname ${definition.name}`);
		}
		definitions.set(definition.name, definition);
	}

	await reloadAttachments();
	for (const definition of definitions.values()) {
		await definition.initialize?.();
	}
	return definitions.size;
};

const isAttached = (name, channel) => {
	const definition = definitions.get(name);
	if (!definition) {
		return false;
	}
	return definition.scope === 'global' || Boolean(channelAttachments.get(channel?.id)?.has(name));
};

/** Event an alle passenden Module verteilen; Fehler eines Moduls stoppen die anderen nicht */
const dispatch = (event, context) => {
	const channel = context.channel ?? null;
	// Parallelbetrieb: nur Ereignisse aus bedienten Channels (sonst z. B. Whispers von live-detection doppelt zum alten Bot)
	if (channel && !isServed(channel.name)) {
		return;
	}
	const full = { platform: bot.Twitch, ...context };
	for (const definition of definitions.values()) {
		const handler = definition.handlers?.[event];
		if (!handler) {
			continue;
		}

		let runtime;
		if (definition.scope === 'global') {
			runtime = { args: null };
		} else if (channel) {
			runtime = channelAttachments.get(channel.id)?.get(definition.name);
		}
		if (!runtime) {
			continue;
		}

		Promise.resolve()
			.then(() => handler(full, runtime))
			.catch((e) => Logger.warn('Chat-Modul-Fehler', { module: definition.name, event, channel: channel?.name ?? null, error: e }));
	}
};

/** PubSub-Events: ohne Channel nur an globale Module (gleiche Verteilung wie dispatch) */
const dispatchPubSub = (event, context) => dispatch(event, context);

const names = () => [...definitions.keys()];
const list = () => [...definitions.values()];

const destroy = () => {
	for (const definition of definitions.values()) {
		definition.destroy?.();
	}
};

/** Nur Durchreichen (bisher classes/chat-module.ts) - Module bleiben so lesbar wie im alten Bot */
const defineChatModule = (definition) => definition;

module.exports = { defineChatModule, load, reloadAttachments, isAttached, dispatch, dispatchPubSub, names, list, destroy };
