const { Schema, model, models } = require('mongoose');
const specs = require('./data-specs.js');

// Models der Feature-Collections aus data-specs.js: bot.DB.WatchStreak, bot.DB.NotifyLive, ...

const TYPES = { String, Number, Boolean, Date, Mixed: Schema.Types.Mixed };

const buildSchema = (spec) => {
	const definition = {};
	for (const [field, info] of Object.entries(spec.fields)) {
		const entry = { type: TYPES[info.type] };
		if (info.enum) {
			entry.enum = [...info.enum, null];
		}
		if (info.default === 'now') {
			entry.default = Date.now;
		} else if (info.default !== undefined) {
			entry.default = info.default;
		} else if (!info.required && field !== '_id') {
			entry.default = null;
		}
		definition[field] = entry;
	}
	if (!spec.counter) {
		delete definition._id;
	}

	const schema = new Schema(definition, { collection: spec.collection, versionKey: false, minimize: false });
	if (!spec.counter && spec.key.length > 0) {
		schema.index(Object.fromEntries(spec.key.map((field) => [field, 1])), { unique: true });
	}
	for (const index of spec.indexes) {
		schema.index(Object.fromEntries(index.fields.map((field) => [field, 1])), { unique: index.unique });
	}
	return schema;
};

const dataModels = {};
for (const spec of specs) {
	dataModels[spec.model] = models[spec.model] ?? model(spec.model, buildSchema(spec));
}

/** Naechste ID fuer eine Collection mit Zaehler: await bot.DB.nextIdFor('ModerationBanLog') */
const counterOf = (modelName) => specs.find((i) => i.model === modelName)?.counter ?? null;

module.exports = { dataModels, dataSpecs: specs, counterOf };
