// Datenschalter fuer User und Channel (bisher classes/custom-data-properties.ts): jede Eigenschaft ist hier mit Typ
// deklariert, unbekannte Namen werden abgelehnt. Gespeichert im Feld "data" des Channel- bzw. User-Dokuments.

const userDataSchema = {
	administrator: 'boolean',
	// set location: { formatted, placeID, components, hidden, coordinates: { lat, lng } } (wie Supibot)
	location: 'object',
	// !uts: Zeitzone als Eingabe ("UTC+1", "CET"), wird bei jeder Abfrage neu ausgewertet
	timezone: 'string',
	// Dashboard: eigene Reihenfolge der Seitenleiste
	dashboardSidebar: 'object',
};

const channelDataSchema = {
	// Prefix-Override pro Channel (setprefix)
	prefix: 'string',
	// Moderation (aus sb-v2s channel_settings)
	autobanDisabled: 'boolean',
	autobanPromoDisabled: 'boolean',
	autobanAgecheckDisabled: 'boolean',
	autobanSpamDisabled: 'boolean',
	autobanAnnounce: 'boolean',
	botbansText: 'string',
	crossbanOptIn: 'boolean',
	// Erkennung - alle Default aus, Probelauf der Raid-Erkennung Default an
	raidProtection: 'boolean',
	raidProtectionDryRun: 'boolean',
	languageModeration: 'boolean',
	newAccountGuard: 'boolean',
	newAccountFollowersGuard: 'boolean',
	followProtection: 'boolean',
	// Channel verlassen: { reason, since, previousMode } wie Supibots inactiveReason
	inactive: 'object',
	// Periodische Posts - naechster Termin in ms
	autostatus: 'boolean',
	autostatusNext: 'number',
	botpromo: 'boolean',
	botpromoNext: 'number',
	clipthatEveryone: 'boolean',
	// Ansagen - alle Default aus
	raidShoutout: 'boolean',
	followMessage: 'boolean',
	followMessageText: 'string',
	subMessage: 'boolean',
	subMessageText: 'string',
	subGiftMessageText: 'string',
	autobanCountBase: 'number',
	// Supibots 7tv: rotierende Emote-Liste je Channel
	sevenTvRotatingEmotes: 'object',
	sevenTvStreamerOnly: 'boolean',
	// Dashboard: neue globale Badges/Emotes melden - { enabled, message } (Default aus)
	badgeAlerts: 'object',
	// strengere Rechte-Stufe je Command: Name -> "mod" | "streamer"
	commandLevels: 'object',
	// !sic-Speicherplaetze: Platz -> { game, title }
	streamInfoSlots: 'object',
};

const checkValue = (type, value) => {
	if (value === null) {
		return true;
	} else if (type === 'object') {
		return typeof value === 'object' && !Array.isArray(value);
	}
	return typeof value === type;
};

const assertProperty = (schema, kind, property) => {
	if (!Object.hasOwn(schema, property)) {
		throw new Error(`Unknown ${kind} data property "${property}"`);
	}
	return schema[property];
};

/** Wert aus entity.data (null wenn nicht gesetzt) */
const read = (schema, kind, entity, property) => {
	assertProperty(schema, kind, property);
	return entity.data?.[property] ?? null;
};

/** Wert pruefen, in der DB setzen bzw. loeschen und im Objekt nachziehen */
const write = async (schema, kind, model, entity, property, value) => {
	const type = assertProperty(schema, kind, property);
	if (!checkValue(type, value)) {
		throw new Error(`Invalid value type for ${kind} data property "${property}" (expected ${type})`);
	}

	const update = value === null ? { $unset: { [`data.${property}`]: '' } } : { $set: { [`data.${property}`]: value } };
	await model.updateOne({ _id: entity.id }, update);

	entity.data ??= {};
	if (value === null) {
		delete entity.data[property];
	} else {
		entity.data[property] = value;
	}
};

module.exports = { userDataSchema, channelDataSchema, checkValue, read, write };
