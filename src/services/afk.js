const { randArray, timeDelta } = require('../misc/utility.js');
const definitions = require('../data/afk-definitions.json');

// Supibots AFK (bisher classes/afk.ts): aktive Status im Speicher je User-ID, Rueckkehr bei der naechsten Nachricht

const afkStatuses = ['afk', 'gn', 'brb', 'shower', 'poop', 'lurk', 'work', 'study', 'nap', 'food'];
const NO_TEXT_AFK = '(no message)';
const DEFAULT_AFK_STATUS = 'afk';

const active = new Map(); // userId -> { id, userId, started, text, status }

/** Rueckkehr-Spruch: dauerabhaengig (z. B. "gn" nach 5 Minuten), sonst statisch */
const pickStatusMessage = (status, minutesDelta) => {
	for (const definition of definitions.responses.duration[status] ?? []) {
		const minimum = definition.interval[0];
		const maximum = definition.interval[1] ?? Infinity;
		if (minimum < minutesDelta && minutesDelta < maximum) {
			return randArray(definition.responses);
		}
	}
	return randArray(definitions.responses.static[status]);
};

const fromDoc = (doc) => ({ id: doc._id, userId: doc.userId, started: doc.started, text: doc.text ?? NO_TEXT_AFK, status: doc.status ?? DEFAULT_AFK_STATUS });

const load = async () => {
	active.clear();
	for (const doc of await bot.DB.AFK.find({ active: true }).lean()) {
		active.set(doc.userId, fromDoc(doc));
	}
	return active.size;
};

const get = (user) => active.get(typeof user === 'number' ? user : user.id) ?? null;
const getById = (id) => [...active.values()].find((i) => i.id === id) ?? null;

/** Beendet einen aktiven Status und kuendigt die Rueckkehr an - bei jeder Chatnachricht */
const checkActive = async (user, channel, displayName = user.name) => {
	// Zuerst synchron entfernen, damit parallele Nachrichten nicht doppelt ansagen
	const data = active.get(user.id);
	if (!data) {
		return;
	}
	active.delete(user.id);

	await bot.DB.AFK.updateOne({ _id: data.id }, { $set: { active: false, ended: new Date() } });

	const minutesDelta = (Date.now() - new Date(data.started).getTime()) / 60_000;
	// Supibots Sprueche nennen Commands mit "$" - durch den echten Prefix ersetzen
	const statusMessage = pickStatusMessage(data.status, minutesDelta).replaceAll('$', bot.Config.prefix);
	await bot.Channels.send(channel, `@${displayName} ${statusMessage}: ${data.text} (${timeDelta(data.started)})`);
};

/** Neuer Status; interruptedId setzt einen beendeten fort (Dauer zaehlt weiter) */
const set = async (user, data = {}) => {
	const started = data.started ?? new Date();
	const status = data.status ?? DEFAULT_AFK_STATUS;
	const doc = await bot.DB.AFK.create({
		_id: await bot.DB.nextId('afks'),
		userId: user.id,
		text: data.text ?? null,
		started,
		status,
		active: true,
		interruptedId: data.interruptedId ?? null,
	});
	const afk = fromDoc(doc.toObject());
	active.set(user.id, afk);
	return afk;
};

module.exports = { afkStatuses, definitions, NO_TEXT_AFK, pickStatusMessage, load, get, getById, checkActive, set, _active: active };
