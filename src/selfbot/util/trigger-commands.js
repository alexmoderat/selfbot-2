const { Logger } = require('../misc/logger.js');
const { randomUUID } = require('node:crypto');

// Trigger-Commands (Collection triggerCommand), aus sb-v2s singletons/trigger-commands.ts: Muster, die beim Auftreten
// im Chat eine Antwort ausloesen. Hier Cache, Cooldowns und Verwaltung; Ausfuehrung im Chat-Modul trigger-commands.
// Datensaetze in der alten Form ({ ID, UUID, Channel, Pattern, Response, Cooldown, ... }).

const CACHE_TTL = 60_000;
const cache = new Map();
const cooldowns = new Map();

const list = async (channelId) => (await bot.DB.TriggerCommand.find({ channel: channelId }).sort({ created: 1 }).lean()).map((doc) => bot.DB.toRow('TriggerCommand', doc));

const getForChannel = async (channel) => {
	const cached = cache.get(channel.id);
	if (cached && Date.now() - cached.at < CACHE_TTL) {
		return cached.rows;
	}

	try {
		const rows = await list(channel.id);
		cache.set(channel.id, { rows, at: Date.now() });
		return rows;
	} catch (e) {
		Logger.warn(`[trigger-commands] #${channel.name} nicht ladbar`, e);
		return cached?.rows ?? [];
	}
};

const invalidate = (channelId) => {
	cache.delete(channelId);
};

/** Whitelist als ID-Liste */
const parseWhitelist = (raw) => {
	if (!raw) {
		return [];
	}

	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value.map(String) : [];
	} catch {
		return [];
	}
};

/** true = noch im Cooldown; sonst wird er gesetzt. key = User-ID, Login oder "*" (globaler Cooldown) */
const onCooldown = (channelId, triggerId, key, seconds, now = Date.now()) => {
	if (!seconds) {
		return false;
	}

	const cooldownKey = `${channelId}:${triggerId}:${key}`;
	if (now - (cooldowns.get(cooldownKey) ?? 0) < seconds * 1000) {
		return true;
	}

	cooldowns.set(cooldownKey, now);
	if (cooldowns.size > 10_000) {
		cooldowns.clear();
	}
	return false;
};

const escapeRegex = (input) => input.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * trigger:/pattern/flags -> echtes Regex (Flags abgeschnitten, beim Ausfuehren gilt immer "i"; alexmoderat, 13.10.2026:
 * "/^test$/i" wurde frueher woertlich gespeichert). trigger:wort -> escaped, als Teilstring gesucht; exact:true
 * verankert zusaetzlich ^...$ fuer den "komplette Nachricht"-Fall ("kannst du es vllt auch ohne regex machen").
 */
const parseTrigger = (raw, exact) => {
	if (!raw) {
		return null;
	}

	const match = raw.match(/^\/(.+)\/[a-z]*$/i);
	if (match) {
		return match[1];
	}

	const escaped = escapeRegex(raw);
	return exact ? `^${escaped}$` : escaped;
};

const add = async (channel, trigger, response, options) => {
	const uuid = randomUUID();
	await bot.DB.createWithId('TriggerCommand', {
		uuid,
		channel: channel.id,
		pattern: trigger,
		response,
		...bot.DB.fromRow('TriggerCommand', options),
		created: new Date(),
	});
	invalidate(channel.id);
	return uuid;
};

/** Per UUID(-Anfang); liefert die volle UUID oder null */
const removeByPrefix = async (channel, prefix) => {
	const rows = (await list(channel.id)).filter((i) => i.UUID.startsWith(prefix));
	if (rows.length !== 1) {
		return null;
	}

	await bot.DB.TriggerCommand.deleteOne({ _id: rows[0].ID });
	invalidate(channel.id);
	return rows[0].UUID;
};

module.exports = { list, getForChannel, invalidate, parseWhitelist, onCooldown, parseTrigger, add, removeByPrefix };
