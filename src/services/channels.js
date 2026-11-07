const dataProperties = require('./data-properties.js');

// Channels (bisher classes/channel.ts): alle beim Start aus der DB, Zugriff per ID, Name oder Twitch-ID.
// Ein Channel ist ein einfaches Objekt { id, name, twitchId, mode, description, linksAllowed, logging, data }.

const channels = new Map();

/** Alte Feldnamen (selfbots Channel-Klasse) als Getter - fuer portierten Code, der sie noch liest */
const LEGACY_FIELDS = {
	ID: 'id',
	Name: 'name',
	Specific_ID: 'twitchId',
	Mode: 'mode',
	Description: 'description',
	Links_Allowed: 'linksAllowed',
	Logging: 'logging',
};
const withLegacy = (entity) => {
	for (const [legacy, field] of Object.entries(LEGACY_FIELDS)) {
		Object.defineProperty(entity, legacy, { get: () => entity[field], enumerable: false });
	}
	// Supibot: auf Twitch einfach der Channelname
	Object.defineProperty(entity, 'getFullName', { value: () => entity.name, enumerable: false });
	Object.defineProperty(entity, 'getDatabaseName', { value: () => entity.name, enumerable: false });
	return entity;
};

const fromDoc = (doc) =>
	withLegacy({
		id: doc._id,
		name: doc.name,
		twitchId: doc.twitchId ?? null,
		mode: doc.mode,
		description: doc.description ?? null,
		linksAllowed: doc.linksAllowed !== false,
		logging: new Set(doc.logging ?? []),
		data: doc.data ?? {},
	});

const load = async () => {
	const docs = await bot.DB.Channel.find({}).lean();
	channels.clear();
	for (const doc of docs) {
		channels.set(doc._id, fromDoc(doc));
	}
	return channels.size;
};

/** @param {number|string|object} identifier ID, Name (mit oder ohne #) oder Channel-Objekt */
const get = (identifier) => {
	if (identifier && typeof identifier === 'object') {
		return identifier;
	} else if (typeof identifier === 'number') {
		return channels.get(identifier) ?? null;
	}

	const name = String(identifier ?? '')
		.toLowerCase()
		.replace(/^#/, '');
	for (const channel of channels.values()) {
		if (channel.name === name) {
			return channel;
		}
	}
	return null;
};

const getByTwitchId = (twitchId) => {
	for (const channel of channels.values()) {
		if (channel.twitchId === twitchId) {
			return channel;
		}
	}
	return null;
};

const all = () => [...channels.values()];
/**
 * Aktive Channels. Parallelbetrieb (config.onlyChannels): nur die bedienten - so greifen auch Crons, Join-Poller,
 * PubSub und Module nirgends sonst ein, solange der alte selfbot dort laeuft.
 */
const getJoinable = () => {
	const only = bot.Config?.onlyChannels;
	const active = all().filter((i) => i.mode !== 'Inactive');
	return Array.isArray(only) && only.length > 0 ? active.filter((i) => only.includes(i.name)) : active;
};

/** Darf der Bot hier schreiben? */
const isWritable = (channel) => channel.mode !== 'Inactive' && channel.mode !== 'Read';

const getData = (channel, property) => dataProperties.read(dataProperties.channelDataSchema, 'channel', channel, property);
const setData = (channel, property, value) => dataProperties.write(dataProperties.channelDataSchema, 'channel', bot.DB.Channel, channel, property, value);

/** Mode, Name oder Description speichern */
const saveProperty = async (channel, property, value) => {
	const field = { Mode: 'mode', Name: 'name', Description: 'description' }[property] ?? property;
	await bot.DB.Channel.updateOne({ _id: channel.id }, { $set: { [field]: value } });
	channel[field] = value;
};

/** Neuer Channel; auch in der alten Form add(name, platform, mode, twitchId) aufrufbar */
const add = async (name, ...rest) => {
	const [mode, twitchId] = rest[0] && typeof rest[0] === 'object' ? rest.slice(1) : rest;
	if (getByTwitchId(twitchId)) {
		throw new Error(`Channel already exists (${name}, ${twitchId})`);
	}
	const doc = await bot.DB.Channel.create({ _id: await bot.DB.nextId('channels'), name: name.toLowerCase(), twitchId, mode, logging: ['Lines', 'Meta'] });
	const channel = fromDoc(doc.toObject());
	channels.set(channel.id, channel);
	return channel;
};

/** Wie Supibots Channel.isLive: null = unbekannt */
const isLive = (channel) => (channel.twitchId ? bot.Live.has(channel.twitchId) : null);

/** Nachricht in den Channel (nur wenn der Bot dort schreiben darf) */
const send = async (channel, message, options = {}) => {
	if (!isWritable(channel)) {
		return;
	}
	await bot.Twitch.send(message, channel, options);
};

module.exports = { load, get, getByTwitchId, all, getJoinable, isWritable, getData, setData, saveProperty, add, isLive, send, fromDoc };
