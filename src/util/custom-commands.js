const { Logger } = require('../misc/logger.js');
const { randomUUID } = require('node:crypto');
const { normalize } = require('../clients/modules/commands.js');
const { chunkMessages } = require('./list-reply.js');
const { resolveVariables } = require('./live-variables.js');

// Custom Commands pro Channel (Collection customCommand), aus sb-v2s singletons/custom-commands.ts. Ein Eintrag wird zu
// einem echten Command-Objekt und laeuft durch denselben Handler wie eingebaute (Rechte, Cooldown, Filter).
// Namen stehen mit "!" in der DB ("!discord") und sind ueber "!discord" wie ueber den Prefix erreichbar.
// Datensaetze in der alten Form ({ ID, UUID, Channel, Name, Response, Cooldown, Mod_Only, Reply, ... }).

const CACHE_TTL = 60_000;
const MESSAGE_LIMIT = 480;
const MESSAGE_GAP_MS = 1_200;
// Flags der eingebauten Vorgaenger: Opt-out/Block des Ziel-Users und Antwort mit "@user, " gelten weiter
const CUSTOM_FLAGS = { '!stalk': ['block', 'external-input', 'mention', 'opt-out', 'pipe'], '!topgames': ['mention', 'pipe'], '!topstreams': ['mention', 'pipe'] };
const TEMPLATE_ONLY = new Set(['!raidping', '!raidreminder']);
const cache = new Map();

const list = async (channel) => (await bot.DB.CustomCommand.find({ channel: channel.id }).sort({ name: 1 }).lean()).map((doc) => bot.DB.toRow('CustomCommand', doc));

/** Kurz gecacht - sb-v2s Vorgaenger fragte pro Nachricht die DB */
const getChannelCommands = async (channel) => {
	const cached = cache.get(channel.id);
	if (cached && Date.now() - cached.at < CACHE_TTL) {
		return cached.rows;
	}

	try {
		const rows = new Map((await list(channel)).map((i) => [i.Name.toLowerCase(), i]));
		cache.set(channel.id, { rows, at: Date.now() });
		return rows;
	} catch (e) {
		Logger.warn(`[custom-commands] DB-Fehler fuer #${channel.name}`, e);
		return cached?.rows ?? new Map();
	}
};

const invalidate = (channel) => {
	cache.delete(channel.id);
};

const get = async (channel, name) => (await getChannelCommands(channel)).get(name.toLowerCase()) ?? null;

/** Ersetzt {user} und {channel} */
const formatResponse = (response, userName, channelName) => response.replaceAll(/\{user\}/gi, `@${userName}`).replaceAll(/\{channel\}/gi, channelName);

/**
 * Zu lange Antworten (z. B. {live_list}) auf mehrere Nachrichten verteilen statt zu kuerzen: an " // " getrennt, sonst
 * an Leerzeichen; nichts wird zerschnitten
 */
const splitMessages = (text) => {
	if (text.length <= MESSAGE_LIMIT) {
		return [text];
	}
	const sep = text.includes(' // ') ? ' // ' : ' ';
	return chunkMessages('', text.split(sep), sep, MESSAGE_LIMIT);
};

/** Command-Objekt fuer einen Aufruf ("discord" oder "!discord"), sonst null */
const resolve = async (channel, invocation) => {
	const rows = await getChannelCommands(channel);
	const name = invocation.toLowerCase();
	const row = rows.get(name) ?? rows.get(`!${name}`);
	// Vorlagen fuer den raid-notifier ({users}, {seconds}), im Chat nicht abrufbar
	if (!row || TEMPLATE_ONLY.has(row.Name.toLowerCase())) {
		return null;
	}

	return normalize(
		{
			// Eigener Namensraum, damit Cooldowns nicht mit eingebauten Commands kollidieren
			name: `custom:${channel.id}:${row.Name.replace(/^!/, '')}`,
			description: `Custom command of #${channel.name}`,
			cooldown: row.Cooldown * 1000,
			flags: [...(row.Mod_Only ? ['mod'] : []), ...(CUSTOM_FLAGS[row.Name.toLowerCase()] ?? [])],
			execute: async (client, msg) => {
				// In sb-v2s Vorgaenger gespeichert und angezeigt, aber nie geprueft - hier durchgesetzt
				if (row.Online_Only || row.Offline_Only) {
					const live = bot.Channels.isLive(channel);
					if ((row.Online_Only && live === false) || (row.Offline_Only && live === true)) {
						return { success: false, text: null };
					}
				}

				const response = await resolveVariables(formatResponse(row.Response, msg.sender.name, channel.name), msg.args ?? [], {
					channel: channel.name,
					twitchId: channel.twitchId,
					sender: msg.sender,
					msg,
				});
				const messages = splitMessages(row.Reply ? `@${msg.sender.name}, ${response}` : response);
				if (messages.length === 1) {
					return { text: messages[0] };
				}
				for (const [i, text] of messages.entries()) {
					if (i > 0) {
						await new Promise((resolve) => setTimeout(resolve, MESSAGE_GAP_MS));
					}
					await bot.Channels.send(channel, text);
				}
				return { success: true, text: null };
			},
		},
		'custom-command',
	);
};

/** options mit Spaltennamen ({ Cooldown, Mod_Only, Reply, Online_Only, Offline_Only }) */
const add = async (channel, name, response, options) => {
	const uuid = randomUUID();
	await bot.DB.createWithId('CustomCommand', {
		uuid,
		channel: channel.id,
		name: name.toLowerCase(),
		response,
		...bot.DB.fromRow('CustomCommand', options),
		created: new Date(),
	});
	invalidate(channel);
	return uuid;
};

const edit = async (existing, response, options, newName) => {
	await bot.DB.CustomCommand.updateOne(
		{ _id: existing.ID },
		{ $set: { response, modified: new Date(), ...(newName ? { name: newName.toLowerCase() } : {}), ...bot.DB.fromRow('CustomCommand', options) } },
	);
	cache.delete(existing.Channel);
};

const remove = async (existing) => {
	await bot.DB.CustomCommand.deleteOne({ _id: existing.ID });
	cache.delete(existing.Channel);
};

module.exports = { splitMessages, list, invalidate, get, formatResponse, resolve, add, edit, remove };
