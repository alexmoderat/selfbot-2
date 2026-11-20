// Schema-Beschreibung fuer die Postgres-Tabellen. Die Modelle in models/index.js und models/data.js benutzen
// weiter die Schreibweise der bisherigen Mongoose-Schemas ({ feld: { type, default, enum, required, unique } }),
// daraus entstehen Spalten (camelCase wie die Felder) und Indizes.

/** Platzhalter fuer Felder mit beliebigem JSON-Inhalt (bisher Schema.Types.Mixed) */
const Mixed = Object.freeze({ name: 'Mixed' });

const PG_TYPES = new Map([
	[String, 'text'],
	[Number, 'double precision'],
	[Boolean, 'boolean'],
	[Date, 'timestamptz'],
	[Mixed, 'jsonb'],
]);

/** Spalten einer Definition: Name -> { name, pg, json, default, enum, unique } */
const buildFields = (definition) => {
	const fields = new Map();
	for (const [name, raw] of Object.entries(definition)) {
		const entry = raw && typeof raw === 'object' && !Array.isArray(raw) && 'type' in raw && !(raw === Mixed) ? raw : { type: raw };
		const type = entry.type;
		let pg = Array.isArray(type) ? 'jsonb' : PG_TYPES.get(type);
		if (!pg) {
			throw new Error(`Unbekannter Typ fuer ${name}`);
		}
		if (name === '_id' && pg === 'double precision') {
			pg = 'bigint';
		}
		fields.set(name, { name, pg, json: pg === 'jsonb', default: entry.default, enum: entry.enum, unique: entry.unique === true, array: Array.isArray(type) });
	}
	return fields;
};

/** Standardwert eines Feldes beim Anlegen (Funktionen werden aufgerufen, Objekte kopiert) */
const defaultOf = (field) => {
	const value = field.default;
	if (typeof value === 'function') {
		const result = value();
		return field.pg === 'timestamptz' && typeof result === 'number' ? new Date(result) : result;
	}
	if (value && typeof value === 'object' && !(value instanceof Date)) {
		return structuredClone(value);
	}
	return value === undefined ? null : value;
};

/** Index [{ feld: 1, feld2: -1 }, { unique, partialFilterExpression, expireAfterSeconds }] -> Beschreibung */
const buildIndex = (keys, options = {}) => ({
	keys: Object.entries(keys).map(([field, direction]) => ({ field, desc: direction === -1 })),
	unique: options.unique === true,
	partial: options.partialFilterExpression ? Object.keys(options.partialFilterExpression) : null,
	ttl: options.expireAfterSeconds ?? null,
});

module.exports = { Mixed, buildFields, defaultOf, buildIndex };
