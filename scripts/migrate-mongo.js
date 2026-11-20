// Einmalige Umstellung MongoDB -> Postgres: kopiert alle Collections des Bots (Stand seit dem Umschalten auf selfbot-next,
// MariaDB ist veraltet) in die gleichnamigen Tabellen und gleicht danach die Zeilenzahlen ab. Wiederholbar: bereits
// vorhandene Zeilen (gleiche _id bzw. eindeutiger Schluessel) bleiben stehen.
//
//   yarn migrate:mongo [--fresh] [Modell ...]     --fresh leert die Tabellen vorher
//
// Mongo-Adresse: config.json "mongo.uri" oder Umgebungsvariable MONGO_URI. Mongo wird nur gelesen.

const { MongoClient } = require('mongodb');
const { getConfig } = require('../src/config.js');
const DB = require('../src/database/db.js');

const BATCH = 5000;

/** Wert eines Mongo-Dokuments in den Typ der Spalte bringen (Mongo war da nachsichtiger) */
const convert = (field, value) => {
	if (value === undefined || value === null) {
		return null;
	}
	if (field.json) {
		return value;
	}
	switch (field.pg) {
		case 'text':
			return typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : String(value);
		case 'double precision':
		case 'bigint':
			return Number(value);
		case 'boolean':
			return Boolean(value);
		case 'timestamptz':
			return value instanceof Date ? value : new Date(value);
		default:
			return value;
	}
};

const toRow = (model, doc) => {
	const row = {};
	for (const field of model.fields.values()) {
		if (field.identity) {
			continue;
		}
		row[field.name] = convert(field, doc[field.name]);
	}
	return row;
};

const main = async () => {
	const config = getConfig();
	const uri = config.mongo?.uri ?? process.env.MONGO_URI;
	if (!uri) {
		throw new Error('config.json "mongo.uri" oder MONGO_URI fehlt');
	}
	const fresh = process.argv.includes('--fresh');
	const only = process.argv.slice(2).filter((i) => i !== '--fresh');

	await DB.connect(config.postgres);
	const mongo = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 10_000 });
	const db = mongo.db();
	const results = [];
	try {
		const models = Object.values(DB).filter((i) => i?.collectionName && (only.length === 0 || only.includes(i.modelName)));
		for (const model of models) {
			const start = Date.now();
			console.log(`[${model.modelName}] ...`);
			const collection = db.collection(model.collectionName);
			if (fresh) {
				await model.deleteMany({});
			}
			let batch = [];
			let read = 0;
			const flush = async () => {
				if (batch.length > 0) {
					await model.insertMany(batch, { ordered: false });
					batch = [];
				}
			};
			for await (const doc of collection.find({})) {
				batch.push(toRow(model, doc));
				read++;
				if (batch.length >= BATCH) {
					await flush();
				}
			}
			await flush();
			console.log(`[${model.modelName}] ${read} gelesen in ${((Date.now() - start) / 1000).toFixed(1)} s`);
			const expected = await collection.countDocuments();
			const actual = await model.countDocuments();
			results.push({
				Modell: model.modelName,
				Mongo: expected,
				Postgres: actual,
				Sekunden: ((Date.now() - start) / 1000).toFixed(1),
				Gelesen: read,
				// Mit --fresh muss Postgres genau die gelesenen Dokumente enthalten; Mongo darf sich waehrenddessen aendern
				// (laufender Bot, TTL-Loeschung von JoinerMessage/JoinerBan), das steht dann nur als Hinweis in der Spalte "Mongo"
				Gleich: actual === (fresh ? read : expected) ? 'ja' : 'NEIN',
			});
		}
		console.table(results);
		const wrong = results.filter((i) => i.Gleich !== 'ja');
		if (wrong.length > 0) {
			console.error(`${wrong.length} Modell(e) mit Abweichung: ${wrong.map((i) => i.Modell).join(', ')}`);
			process.exitCode = 1;
		} else {
			console.log('Alles gleich.');
		}
	} finally {
		await mongo.close();
		await DB.disconnect();
	}
};

main().catch((e) => {
	console.error('Migration fehlgeschlagen', e);
	process.exit(1);
});
