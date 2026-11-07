const mongoose = require('mongoose');
const { Logger } = require('../misc/logger.js');
const coreModels = require('./models/index.js');
const { dataModels, dataSpecs, counterOf, toRow, fromRow } = require('./models/data.js');

const models = { ...coreModels, ...dataModels };

// MongoDB wie bei DontAddThisBot (bot.DB.<Model>), Verbindung aus config.json

mongoose.set('strictQuery', true);

const connect = async (uri) => {
	mongoose.connection.on('connected', () => Logger.info('[db] Mit MongoDB verbunden'));
	mongoose.connection.on('disconnected', () => Logger.warn('[db] Verbindung zu MongoDB getrennt'));
	mongoose.connection.on('error', (e) => Logger.error('[db] MongoDB-Fehler', e));

	await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
	await Promise.all(Object.values(models).map((model) => model.init()));
};

/** Naechste numerische ID fuer eine Collection (wie AUTO_INCREMENT), atomar ueber "counters" */
const nextId = async (name) => {
	const counter = await models.Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
	return counter.seq;
};

/** Zaehler mindestens auf value setzen (nach der Migration: hoechste uebernommene ID) */
const ensureCounterAtLeast = async (name, value) => {
	await models.Counter.updateOne({ _id: name }, { $max: { seq: value } }, { upsert: true });
};

const disconnect = () => mongoose.disconnect();

/** Dokument mit naechster numerischer ID anlegen (Collections mit Zaehler, z. B. ModerationBanLog) */
const createWithId = async (modelName, data) => {
	const counter = counterOf(modelName);
	if (!counter) {
		throw new Error(`${modelName} hat keine numerische ID`);
	}
	return await models[modelName].create({ _id: await nextId(counter), ...data });
};

module.exports = { ...models, connect, disconnect, nextId, ensureCounterAtLeast, createWithId, dataSpecs, toRow, fromRow, mongoose };
