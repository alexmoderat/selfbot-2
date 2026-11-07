const mongoose = require('mongoose');
const { Logger } = require('../misc/logger.js');
const models = require('./models/index.js');

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

module.exports = { ...models, connect, disconnect, nextId, ensureCounterAtLeast, mongoose };
